import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('ClientBootstrap', () => {
  beforeEach(() => {
    //1.- Reset module state so environment changes are honoured between assertions.
    vi.resetModules()
    cleanup()
  })

  it('informs the user when the broker URL is missing', async () => {
    //1.- Ensure the public environment variable is absent for this scenario.
    delete process.env.NEXT_PUBLIC_BROKER_URL
    const { default: ClientBootstrap } = await import('./ClientBootstrap')
    render(<ClientBootstrap />)
    expect(
      screen.getByText(
        /Broker URL missing. Create a .env.local file with NEXT_PUBLIC_BROKER_URL=ws:\/\/localhost:43127\/ws to enable live telemetry./i,
      ),
    ).toBeInTheDocument()
  })

  it('confirms readiness when the broker URL is configured', async () => {
    //1.- Provide the websocket endpoint so the component reports readiness.
    process.env.NEXT_PUBLIC_BROKER_URL = 'ws://localhost:43127/ws'
    const { default: ClientBootstrap } = await import('./ClientBootstrap')
    render(<ClientBootstrap />)
    expect(screen.getByTestId('status-message').textContent).toContain('ws://localhost:43127/ws')
  })
})
