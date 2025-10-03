import { cleanup, render, screen } from '@testing-library/react'
import { act } from 'react-dom/test-utils'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('ClientBootstrap', () => {
  beforeEach(() => {
    //1.- Reset module state so environment changes are honoured between assertions.
    vi.resetModules()
    cleanup()
  })

  async function renderBootstrap() {
    //1.- Import lazily so the component reads the test-specific environment state.
    const { default: ClientBootstrap } = await import('./ClientBootstrap')
    render(<ClientBootstrap />)
  }

  it('displays the loading banner on the first paint', async () => {
    //1.- Leave NEXT_PUBLIC_BROKER_URL undefined so the component follows its default branch.
    delete process.env.NEXT_PUBLIC_BROKER_URL
    await renderBootstrap()
    expect(screen.getByTestId('status-message').textContent).toBe('Loading web client shell…')
  })

  it('informs the user when the broker URL is missing', async () => {
    //1.- Flush the deferred status update and expect the warning copy.
    vi.useFakeTimers()
    delete process.env.NEXT_PUBLIC_BROKER_URL
    await renderBootstrap()
    await act(async () => {
      vi.runAllTimers()
    })
    expect(() =>
      screen.getByText(
        /Broker URL missing. Create a .env.local file with NEXT_PUBLIC_BROKER_URL=ws:\/\/localhost:43127\/ws to enable live telemetry./i,
      ),
    ).not.toThrow()
    vi.useRealTimers()
  })

  it('confirms readiness when the broker URL is configured', async () => {
    //1.- Provide the websocket endpoint and run the queued status update.
    vi.useFakeTimers()
    process.env.NEXT_PUBLIC_BROKER_URL = 'ws://localhost:43127/ws'
    await renderBootstrap()
    await act(async () => {
      vi.runAllTimers()
    })
    expect(screen.getByTestId('status-message').textContent).toContain('ws://localhost:43127/ws')
    vi.useRealTimers()
  })

  it('lays out the bootstrap panel beside the mount anchors', async () => {
    //1.- Inspect the layout structure to confirm the instructions and mounts are present.
    delete process.env.NEXT_PUBLIC_BROKER_URL
    await renderBootstrap()
    const layout = screen.getByTestId('bootstrap-layout')
    expect(layout.classList.contains('bootstrap-layout')).toBe(true)
    expect(() => screen.getByRole('region', { hidden: true, name: 'Client mounts' })).not.toThrow()
    expect(() => screen.getByLabelText('3D world mount')).not.toThrow()
    expect(() => screen.getByLabelText('HUD overlay mount')).not.toThrow()
    expect(() => screen.getByRole('heading', { name: 'Interaction readiness checklist' })).not.toThrow()
  })
})
