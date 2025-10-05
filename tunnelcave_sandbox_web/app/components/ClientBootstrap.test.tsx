import React from 'react'
import { act } from 'react-dom/test-utils'
import { fireEvent, waitFor } from '@testing-library/react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mountClientShell = vi.fn(async () => 'active')
const unmountClientShell = vi.fn()

vi.mock('../../src/runtime/clientShell', () => ({
  mountClientShell,
  unmountClientShell,
}))

describe('ClientBootstrap', () => {
  let container: HTMLDivElement
  let root: Root | null

  beforeEach(() => {
    //1.- Reset module caches and recreate a clean DOM container for each scenario.
    vi.resetModules()
    mountClientShell.mockClear()
    unmountClientShell.mockClear()
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    root = null
    try {
      window.history.replaceState(null, '', '/')
    } catch {
      //1.- Ignore history errors triggered by jsdom security constraints.
    }
  })

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
    const { default: ClientBootstrap } = await import('./ClientBootstrap')
    await renderComponent(<ClientBootstrap />)
    await act(async () => {
      //1.- Allow the effect microtasks to settle so lazy imports can be observed.
      await Promise.resolve()
    })
    const message = container.querySelector('[data-testid="status-message"]')
    const text = message?.textContent ?? ''
    expect(text).toMatch(/Broker URL missing/i)
    expect(text).toContain('NEXT_PUBLIC_BROKER_URL=ws://localhost:43127/ws')
    expect(mountClientShell).not.toHaveBeenCalled()
    await teardown()
  })

  it('confirms readiness when the broker URL is configured', async () => {
    //1.- Provide the websocket endpoint so the component reports readiness.
    process.env.NEXT_PUBLIC_BROKER_URL = 'ws://localhost:43127/ws'
    const { default: ClientBootstrap } = await import('./ClientBootstrap')
    await renderComponent(<ClientBootstrap />)
    await act(async () => {
      //1.- Resolve any pending tasks spawned by the lazy runtime import.
      await Promise.resolve()
    })
    const message = container.querySelector('[data-testid="status-message"]')
    const statusText = message?.textContent ?? ''
    expect(statusText).toContain('ws://localhost:43127/ws')
    expect(statusText).toContain('Pilot: sandbox-player')
    expect(statusText).toContain('Vehicle: arrowhead')
    expect(mountClientShell).toHaveBeenCalledWith({
      brokerUrl: 'ws://localhost:43127/ws',
      playerProfile: { pilotName: '', vehicleId: 'arrowhead' },
    })
    await teardown()
    expect(unmountClientShell).toHaveBeenCalled()
  })

  it('reports passive startup when the runtime cannot establish a live session', async () => {
    process.env.NEXT_PUBLIC_BROKER_URL = 'ws://localhost:43127/ws'
    mountClientShell.mockResolvedValueOnce('passive')
    const { default: ClientBootstrap } = await import('./ClientBootstrap')
    await renderComponent(<ClientBootstrap />)
    await act(async () => {
      //1.- Allow the async runtime import and passive mount result to propagate to state updates.
      await Promise.resolve()
      await Promise.resolve()
    })
    const message = container.querySelector('[data-testid="status-message"]')
    const statusText = message?.textContent ?? ''
    expect(statusText).toContain('Client shell started without a live broker session')
    await teardown()
  })

  it('commits lobby selections and remounts the client shell on start', async () => {
    process.env.NEXT_PUBLIC_BROKER_URL = 'ws://localhost:43127/ws'
    const { default: ClientBootstrap } = await import('./ClientBootstrap')
    await renderComponent(<ClientBootstrap />)
    await act(async () => {
      await Promise.resolve()
    })

    const nameInput = container.querySelector<HTMLInputElement>('[data-testid="pilot-name-input"]')
    const vehicleSelect = container.querySelector<HTMLSelectElement>('[data-testid="vehicle-select"]')
    const startButton = container.querySelector<HTMLButtonElement>('[data-testid="start-session-button"]')

    expect(nameInput).not.toBeNull()
    expect(vehicleSelect).not.toBeNull()
    expect(startButton).not.toBeNull()

    if (nameInput) {
      fireEvent.change(nameInput, { target: { value: 'Nova Seeker' } })
    }
    if (vehicleSelect) {
      fireEvent.change(vehicleSelect, { target: { value: 'aurora' } })
    }
    if (startButton) {
      fireEvent.click(startButton)
    }

    await waitFor(() => {
      expect(mountClientShell).toHaveBeenCalledTimes(2)
    })
    expect(mountClientShell).toHaveBeenLastCalledWith({
      brokerUrl: 'ws://localhost:43127/ws',
      playerProfile: { pilotName: 'Nova Seeker', vehicleId: 'aurora' },
    })
    const params = new URLSearchParams(window.location.search)
    expect(params.get('pilot')).toBe('Nova Seeker')
    expect(params.get('vehicle')).toBe('aurora')

    await teardown()
  })

  it('surfaces a share link that targets the immersive play route', async () => {
    process.env.NEXT_PUBLIC_BROKER_URL = 'ws://localhost:43127/ws'
    const { default: ClientBootstrap } = await import('./ClientBootstrap')
    await renderComponent(<ClientBootstrap />)
    await act(async () => {
      await Promise.resolve()
    })

    const nameInput = container.querySelector<HTMLInputElement>('[data-testid="pilot-name-input"]')
    const shareInput = container.querySelector<HTMLInputElement>('[data-testid="share-url"]')

    expect(shareInput?.value ?? '').toMatch(/^http:\/\/localhost(?::\d+)?\/play/)
    expect(shareInput?.value ?? '').toContain('vehicle=arrowhead')

    if (nameInput) {
      fireEvent.change(nameInput, { target: { value: 'Nova Seeker' } })
    }

    await waitFor(() => {
      const updatedShareInput = container.querySelector<HTMLInputElement>('[data-testid="share-url"]')
      const shareValue = updatedShareInput?.value ?? ''
      const shareUrl = new URL(shareValue)
      expect(shareUrl.pathname).toBe('/play')
      expect(shareUrl.searchParams.get('pilot')).toBe('Nova Seeker')
      expect(shareUrl.searchParams.get('vehicle')).toBe('arrowhead')
    })

    await teardown()
  })
})
