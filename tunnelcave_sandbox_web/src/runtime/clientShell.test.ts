import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hudConstructor = vi.fn()
const hudDisposer = vi.fn()

vi.mock('../hud/controller', () => ({
  HudController: vi.fn().mockImplementation((options) => {
    hudConstructor(options)
    return { dispose: hudDisposer }
  }),
}))

const originalReadyStateDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'readyState')

describe('clientShell', () => {
  beforeEach(() => {
    //1.- Reset module isolation and DOM scaffolding between tests.
    vi.resetModules()
    hudConstructor.mockClear()
    hudDisposer.mockClear()
    document.body.innerHTML = ''
    if (originalReadyStateDescriptor) {
      Object.defineProperty(document, 'readyState', originalReadyStateDescriptor)
    }
  })

  afterEach(() => {
    //1.- Restore the native readyState descriptor so other suites observe browser defaults.
    if (originalReadyStateDescriptor) {
      Object.defineProperty(document, 'readyState', originalReadyStateDescriptor)
    }
    document.body.innerHTML = ''
  })

  it('mounts the renderer and HUD controllers once anchors are ready', async () => {
    document.body.innerHTML = [
      '<div id="canvas-root"></div>',
      '<div id="hud-root"></div>',
    ].join('')
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'loading' })
    const module = await import('./clientShell')
    const mountPromise = module.mountClientShell({ brokerUrl: 'ws://localhost:43127/ws' })
    document.dispatchEvent(new Event('DOMContentLoaded'))
    const mounted = await mountPromise
    expect(mounted).toBe(true)
    expect(module.isClientShellMounted()).toBe(true)
    expect(hudConstructor).toHaveBeenCalledTimes(1)
    const hudRoot = document.getElementById('hud-root') as HTMLDivElement
    expect(hudRoot.dataset.brokerUrl).toBe('ws://localhost:43127/ws')
    const canvas = document.querySelector('#canvas-root canvas[data-role="world-canvas"]')
    expect(canvas).not.toBeNull()
    module.unmountClientShell()
    expect(hudDisposer).toHaveBeenCalledTimes(1)
    expect(hudRoot.dataset.brokerUrl).toBe('')
    expect(module.isClientShellMounted()).toBe(false)
  })

  it('skips mounting when anchors are missing', async () => {
    document.body.innerHTML = '<div id="canvas-root"></div>'
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' })
    const module = await import('./clientShell')
    const mounted = await module.mountClientShell()
    expect(mounted).toBe(false)
    expect(module.isClientShellMounted()).toBe(false)
    expect(hudConstructor).not.toHaveBeenCalled()
  })
})
