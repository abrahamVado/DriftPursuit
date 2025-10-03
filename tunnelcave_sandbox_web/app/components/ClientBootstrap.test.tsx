import React from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('ClientBootstrap', () => {
  let container: HTMLDivElement
  let root: Root | null

  beforeEach(() => {
    //1.- Reset module caches and recreate a clean DOM container for each scenario.
    vi.resetModules()
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    root = null
  })

  const loadComponent = async () => {
    //1.- Replace the heavy three.js scene with a lightweight stub for deterministic tests.
    vi.doMock('./VehicleScene', () => ({
      __esModule: true,
      default: () => <div data-testid="vehicle-scene" />,
    }))
    const module = await import('./ClientBootstrap')
    return module.default
  }

  const renderComponent = async (element: React.ReactElement) => {
    //1.- Render the component within React's act helper so hooks resolve deterministically.
    await act(async () => {
      root = createRoot(container)
      root.render(element)
    })
  }

  const teardown = async () => {
    //1.- Unmount the rendered tree to avoid cross-test leakage of effects or timers.
    if (root) {
      await act(async () => {
        root?.unmount()
      })
      root = null
    }
    container.remove()
  }

  it('informs the user when the broker URL is missing', async () => {
    //1.- Ensure the public environment variable is absent for this scenario.
    delete process.env.NEXT_PUBLIC_BROKER_URL
    const ClientBootstrap = await loadComponent()
    await renderComponent(<ClientBootstrap />)
    const message = container.querySelector('[data-testid="status-message"]')
    expect(message?.textContent ?? '').toMatch(/Broker URL missing/i)
    await teardown()
  })

  it('confirms readiness when the broker URL is configured', async () => {
    //1.- Provide the websocket endpoint so the component reports readiness.
    process.env.NEXT_PUBLIC_BROKER_URL = 'ws://localhost:43127/ws'
    const ClientBootstrap = await loadComponent()
    await renderComponent(<ClientBootstrap />)
    const message = container.querySelector('[data-testid="status-message"]')
    expect(message?.textContent ?? '').toContain('ws://localhost:43127/ws')
    await teardown()
  })
})
