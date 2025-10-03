import React from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import VehicleScene from './VehicleScene'

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three')
  class WebGLRendererMock {
    domElement: HTMLCanvasElement
    constructor(params: { canvas: HTMLCanvasElement }) {
      this.domElement = params.canvas
    }
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
  }
  return { ...actual, WebGLRenderer: WebGLRendererMock }
})

vi.mock('three/examples/jsm/controls/OrbitControls', () => {
  const { Vector3 } = require('three') as typeof import('three')
  return {
    OrbitControls: class {
      target = new Vector3()
      enableDamping = false
      dampingFactor = 0
      constructor() {}
      update() {}
      dispose() {}
    },
  }
})

describe('VehicleScene', () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
  let container: HTMLDivElement
  let root: Root | null

  beforeEach(() => {
    //1.- Prepare a DOM container and fake timers so animation frames can be advanced deterministically.
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    root = null
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      return window.setTimeout(() => {
        callback(performance.now())
      }, 16) as unknown as number
    })
    globalThis.cancelAnimationFrame = ((handle: number) => {
      clearTimeout(handle as unknown as number)
    }) as unknown as typeof globalThis.cancelAnimationFrame
  })

  afterEach(async () => {
    //1.- Dispose the rendered tree, restore timers, and clean the document body between scenarios.
    if (root) {
      await act(async () => {
        root?.unmount()
      })
      root = null
    }
    container.remove()
    globalThis.requestAnimationFrame = originalRequestAnimationFrame
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame
    vi.useRealTimers()
  })

  const renderScene = async (element: React.ReactElement) => {
    //1.- Mount the scene through React DOM's act helper so effects run synchronously during tests.
    await act(async () => {
      root = createRoot(container)
      root.render(element)
    })
  }

  const rerenderScene = async (element: React.ReactElement) => {
    //1.- Update the mounted tree to feed new props like bridge commands into the scene.
    await act(async () => {
      root?.render(element)
    })
  }

  const advanceTime = async (ms: number) => {
    //1.- Step through queued animation frames using Vitest's timer utilities.
    await vi.advanceTimersByTimeAsync(ms)
  }

  const dispatchKey = (type: 'keydown' | 'keyup', key: string) => {
    //1.- Simulate keyboard interaction so WASD and arrow keys toggle vehicle inputs.
    const event = new KeyboardEvent(type, { key })
    window.dispatchEvent(event)
  }

  it('reacts to throttle commands provided through props', async () => {
    await renderScene(<VehicleScene />)
    expect(container.querySelector('[data-testid="throttle-indicator"]')?.textContent ?? '').toContain('Off')

    await rerenderScene(
      <VehicleScene
        externalCommand={{ command: 'throttle', issuedAtMs: typeof performance !== 'undefined' ? performance.now() : Date.now() }}
      />,
    )
    await advanceTime(200)

    expect(container.querySelector('[data-testid="throttle-indicator"]')?.textContent ?? '').toContain('On')
  })

  it('registers keyboard input for steering and braking', async () => {
    await renderScene(<VehicleScene />)

    dispatchKey('keydown', 'ArrowUp')
    await advanceTime(100)
    expect(container.querySelector('[data-testid="throttle-indicator"]')?.textContent ?? '').toContain('On')

    dispatchKey('keydown', 'ArrowLeft')
    await advanceTime(100)
    expect(container.querySelector('[data-testid="steer-indicator"]')?.textContent ?? '').toContain('Left')

    dispatchKey('keydown', 'ArrowDown')
    await advanceTime(100)
    expect(container.querySelector('[data-testid="brake-indicator"]')?.textContent ?? '').toContain('On')
  })

  it('increases speed when throttle is held', async () => {
    await renderScene(<VehicleScene />)
    const initialSpeed = container.querySelector('[data-testid="speed-readout"]')?.textContent ?? ''

    dispatchKey('keydown', 'w')
    await advanceTime(800)
    const speedText = container.querySelector('[data-testid="speed-readout"]')?.textContent ?? ''

    expect(speedText).not.toEqual(initialSpeed)
  })
})
