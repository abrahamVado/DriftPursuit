import React from 'react'
import { act } from 'react-dom/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'

const mountClientShell = vi.fn(async () => true)
const unmountClientShell = vi.fn()

vi.mock('../../src/runtime/clientShell', () => ({
  mountClientShell,
  unmountClientShell,
}))

describe('FullScreenSession', () => {
  let container: HTMLDivElement
  let root: Root | null

  beforeEach(() => {
    //1.- Reset mocks and establish a clean DOM container before each scenario.
    vi.resetModules()
    mountClientShell.mockClear()
    unmountClientShell.mockClear()
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    root = null
    delete process.env.NEXT_PUBLIC_BROKER_URL
  })

  const renderComponent = async (element: React.ReactElement) => {
    //1.- Render the component using React's testing helper so hooks settle deterministically.
    await act(async () => {
      root = createRoot(container)
      root.render(element)
    })
  }

  const teardown = async () => {
    //1.- Dispose the mounted tree to prevent cross-test leakage of side effects.
    if (root) {
      await act(async () => {
        root?.unmount()
      })
      root = null
    }
    container.remove()
  }

  it('informs the visitor when the broker URL is missing', async () => {
    const { default: FullScreenSession } = await import('./FullScreenSession')
    await renderComponent(<FullScreenSession />)
    const status = container.querySelector('[data-testid="full-session-status"]')
    expect(status?.textContent ?? '').toContain('Broker URL missing')
    expect(mountClientShell).not.toHaveBeenCalled()
    await teardown()
  })

  it('mounts the client shell with the provided pilot and vehicle', async () => {
    process.env.NEXT_PUBLIC_BROKER_URL = 'ws://localhost:43127/ws'
    const { default: FullScreenSession } = await import('./FullScreenSession')
    await renderComponent(<FullScreenSession pilotName="Nova" vehicleId="aurora" />)
    await act(async () => {
      //1.- Allow asynchronous effects to resolve after the lazy import completes.
      await Promise.resolve()
    })
    const status = container.querySelector('[data-testid="full-session-status"]')
    expect(status?.textContent ?? '').toContain('Connected to ws://localhost:43127/ws as Nova')
    expect(mountClientShell).toHaveBeenCalledWith({
      brokerUrl: 'ws://localhost:43127/ws',
      playerProfile: { pilotName: 'Nova', vehicleId: 'aurora' },
    })
    await teardown()
    expect(unmountClientShell).toHaveBeenCalled()
  })
})
