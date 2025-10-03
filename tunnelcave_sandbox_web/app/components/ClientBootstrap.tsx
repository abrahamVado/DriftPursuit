'use client'

import React, { useEffect, useMemo, useState } from 'react'

import InteractionTasks from './InteractionTasks'

const DEFAULT_STATUS = 'Loading web client shell…'

export default function ClientBootstrap() {
  //1.- Capture the broker URL once so hydration and client renders stay consistent.
  const brokerUrl = useMemo(() => process.env.NEXT_PUBLIC_BROKER_URL?.trim() ?? '', [])
  //2.- Track the status message that guides visitors through the setup flow.
  const [status, setStatus] = useState(DEFAULT_STATUS)

  useEffect(() => {
    //1.- Schedule the status update so the loading message appears for an initial paint.
    const timer = window.setTimeout(() => {
      //2.- Explain how to configure the broker when the environment variable is absent.
      if (!brokerUrl) {
        setStatus(
          'Broker URL missing. Create a .env.local file with NEXT_PUBLIC_BROKER_URL=ws://localhost:43127/ws to enable live telemetry.',
        )
        return
      }
      //3.- Confirm to the player that the client is ready to negotiate a session.
      setStatus(`Client ready. Broker endpoint: ${brokerUrl}`)
    }, 0)

    return () => {
      //4.- Prevent stale timers from mutating state after the component unmounts.
      window.clearTimeout(timer)
    }
  }, [brokerUrl])

  //3.- Present the bootstrap instructions alongside DOM anchors for future systems.
  return (
    <main className="bootstrap-layout" data-testid="bootstrap-layout">
      <section className="bootstrap-panel" aria-labelledby="sandbox-title">
        <h1 id="sandbox-title">Drift Pursuit Sandbox</h1>
        <p data-testid="status-message">{status}</p>
        <ol>
          <li>
            Start the broker server locally and expose the websocket endpoint (default
            <code> ws://localhost:43127/ws</code>).
          </li>
          <li>Create <code>.env.local</code> and set NEXT_PUBLIC_BROKER_URL to the broker endpoint.</li>
          <li>Restart this page so the HUD connects using the configured broker URL.</li>
        </ol>
        <InteractionTasks />
      </section>
      <section className="mount-panel" aria-label="Client mounts">
        <div id="canvas-root" aria-label="3D world mount" />
        <div id="hud-root" aria-label="HUD overlay mount" />
      </section>
    </main>
  )
}
