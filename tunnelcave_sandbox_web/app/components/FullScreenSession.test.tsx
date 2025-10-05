import React from 'react'
import { act } from 'react-dom/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'

const mountClientShell = vi.fn(async () => 'active')
const unmountClientShell = vi.fn()
const previewDisposer = vi.fn()
const startOfflineCavePreview = vi.fn(() => previewDisposer)

vi.mock('../../src/runtime/clientShell', () => ({
  mountClientShell,
  unmountClientShell,
}))

vi.mock('./OfflineCavePreview', () => ({
  startOfflineCavePreview,
}))

describe('FullScreenSession', () => {
  let container: HTMLDivElement
  let root: Root | null

  beforeEach(() => {
    //1.- Reset mocks and establish a clean DOM container before each scenario.
    vi.resetModules()
    mountClientShell.mockClear()
    unmountClientShell.mockClear()
    startOfflineCavePreview.mockClear()
    previewDisposer.mockClear()
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

  it('starts the offline preview when the broker URL is missing', async () => {
    const { default: FullScreenSession } = await import('./FullScreenSession')
    await renderComponent(<FullScreenSession />)
    await act(async () => {
      //1.- Resolve the dynamic import of the offline preview helper before assertions run.
      await Promise.resolve()
      await Promise.resolve()
    })
    const status = container.querySelector('[data-testid="full-session-status"]')
    expect(status?.textContent ?? '').toContain('Previewing the infinite cave')
    expect(mountClientShell).not.toHaveBeenCalled()
    expect(startOfflineCavePreview).toHaveBeenCalledTimes(1)
    expect(previewDisposer).not.toHaveBeenCalled()
    await teardown()
    expect(previewDisposer).toHaveBeenCalled()
  })

  it('falls back to the offline preview when the shell mount fails', async () => {
    process.env.NEXT_PUBLIC_BROKER_URL = 'ws://localhost:43127/ws'
    mountClientShell.mockRejectedValueOnce(new Error('boom'))
    const { default: FullScreenSession } = await import('./FullScreenSession')
    await renderComponent(<FullScreenSession pilotName="Nova" vehicleId="aurora" />)
    await act(async () => {
      //1.- Allow asynchronous effects to propagate the failure and start the preview fallback.
      await Promise.resolve()
      await Promise.resolve()
    })
    const status = container.querySelector('[data-testid="full-session-status"]')
    expect(status?.textContent ?? '').toContain('Client shell failed. Showing the offline infinite cave preview.')
    expect(startOfflineCavePreview).toHaveBeenCalledTimes(1)
    await teardown()
    expect(unmountClientShell).toHaveBeenCalled()
  })

  it('mounts the client shell with the provided pilot and vehicle', async () => {
    process.env.NEXT_PUBLIC_BROKER_URL = 'ws://localhost:43127/ws'
    const { default: FullScreenSession } = await import('./FullScreenSession')
    await renderComponent(<FullScreenSession pilotName="Nova" vehicleId="aurora" />)
    await act(async () => {
      //1.- Allow asynchronous effects to resolve after the lazy import completes.
      await Promise.resolve()
      await Promise.resolve()
    })
    const status = container.querySelector('[data-testid="full-session-status"]')
    expect(status?.textContent ?? '').toContain('Connected to ws://localhost:43127/ws as Nova')
    expect(mountClientShell).toHaveBeenCalledWith({
      brokerUrl: 'ws://localhost:43127/ws',
      playerProfile: { pilotName: 'Nova', vehicleId: 'aurora' },
    })
    expect(previewDisposer).toHaveBeenCalled()
    await teardown()
    expect(unmountClientShell).toHaveBeenCalled()
  })

  it('keeps the offline preview when the client shell reports a passive mount', async () => {
    process.env.NEXT_PUBLIC_BROKER_URL = 'ws://localhost:43127/ws'
    mountClientShell.mockResolvedValueOnce('passive')
    const { default: FullScreenSession } = await import('./FullScreenSession')
    await renderComponent(<FullScreenSession pilotName="Nova" vehicleId="aurora" />)
    await act(async () => {
      //1.- Wait for the mount promise to settle so the passive preview message is visible.
      await Promise.resolve()
      await Promise.resolve()
    })
    const status = container.querySelector('[data-testid="full-session-status"]')
    expect(status?.textContent ?? '').toContain('Live session unavailable. Continuing the offline infinite cave preview.')
    expect(startOfflineCavePreview).toHaveBeenCalledTimes(1)
    await teardown()
    expect(unmountClientShell).toHaveBeenCalled()
  })
})
