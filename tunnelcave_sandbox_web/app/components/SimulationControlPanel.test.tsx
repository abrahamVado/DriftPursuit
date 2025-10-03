import React from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SimulationControlPanel from './SimulationControlPanel'
import {
  CONTROL_PANEL_EVENT,
  type ControlPanelIntentDetail,
} from '../../../typescript-client/src/world/vehicleSceneManager'

const originalFetch = global.fetch

describe('SimulationControlPanel', () => {
  let container: HTMLDivElement
  let root: Root | null

  beforeEach(() => {
    //1.- Reset fetch mocks and create a dedicated DOM container per scenario.
    vi.restoreAllMocks()
    delete process.env.NEXT_PUBLIC_SIM_BRIDGE_URL
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    root = null
  })

  afterEach(async () => {
    //1.- Unmount any mounted tree to avoid leaking listeners or timers between runs.
    if (root) {
      await act(async () => {
        root?.unmount()
      })
      root = null
    }
    container.remove()
  })

  afterAll(() => {
    //1.- Restore the original fetch implementation once the test suite completes.
    global.fetch = originalFetch
  })

  const renderPanel = async (element: React.ReactElement) => {
    //1.- Render within React's act helper to ensure layout effects settle synchronously in tests.
    await act(async () => {
      root = createRoot(container)
      root.render(element)
    })
  }

  const flushMicrotasks = async () => {
    //1.- Await the resolution of pending microtasks so chained promises settle before assertions.
    await act(async () => {
      await Promise.resolve()
    })
  }

  it('instructs the user to configure the bridge URL when missing', async () => {
    await renderPanel(<SimulationControlPanel baseUrl="" />)
    const status = container.querySelector('[data-testid="bridge-status"]')
    const error = container.querySelector('[data-testid="bridge-error"]')
    const statusText = status?.textContent ?? ''
    const errorText = error?.textContent ?? ''
    expect(statusText).toContain('offline')
    expect(errorText).toContain('NEXT_PUBLIC_SIM_BRIDGE_URL')
    expect(errorText).toContain('http://localhost:8000')
  })

  it('reports a successful handshake', async () => {
    const handshake = { message: 'Simulation bridge online' }
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => handshake })
    global.fetch = fetchMock as unknown as typeof global.fetch

    await renderPanel(<SimulationControlPanel baseUrl="http://localhost:8080" />)
    await flushMicrotasks()

    const status = container.querySelector('[data-testid="bridge-status"]')
    expect(status?.textContent ?? '').toContain('Simulation bridge online')
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8080/handshake', expect.any(Object))
  })

  it('sends commands to the bridge', async () => {
    const handshake = { message: 'Simulation bridge online' }
    const commandResponse = { command: { command: 'throttle' } }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => handshake })
      .mockResolvedValueOnce({ ok: true, json: async () => commandResponse })
    global.fetch = fetchMock as unknown as typeof global.fetch

    await renderPanel(<SimulationControlPanel baseUrl="http://localhost:8080" />)
    await flushMicrotasks()

    const throttleButton = container.querySelector('button') as HTMLButtonElement
    await act(async () => {
      throttleButton.click()
    })
    await flushMicrotasks()

    const lastCommand = container.querySelector('[data-testid="last-command"]')
    expect(lastCommand?.textContent ?? '').toContain('throttle')
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://localhost:8080/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: expect.stringContaining('throttle'),
    })
  })

  it('emits control intents when buttons are pressed', async () => {
    const handshake = { message: 'Simulation bridge online' }
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => handshake })
    global.fetch = fetchMock as unknown as typeof global.fetch

    const listener = vi.fn()
    window.addEventListener(CONTROL_PANEL_EVENT, listener as EventListener)

    await renderPanel(<SimulationControlPanel baseUrl="http://localhost:8080" />)
    await flushMicrotasks()

    const throttleButton = container.querySelector('button') as HTMLButtonElement
    await act(async () => {
      throttleButton.click()
    })
    await flushMicrotasks()

    expect(listener).toHaveBeenCalledTimes(1)
    const event = listener.mock.calls[0]?.[0] as CustomEvent<ControlPanelIntentDetail>
    expect(event?.detail.control).toBe('throttle')
    expect(event?.detail.value).toBe(1)

    window.removeEventListener(CONTROL_PANEL_EVENT, listener as EventListener)
  })
})
