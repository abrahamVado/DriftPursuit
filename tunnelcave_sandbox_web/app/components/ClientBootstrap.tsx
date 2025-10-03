'use client'

import React, { useEffect, useMemo, useState } from 'react'

import SimulationControlPanel from './SimulationControlPanel'

const DEFAULT_STATUS = 'Loading web client shell…'

export default function ClientBootstrap() {
  //1.- Capture the broker URL once so hydration and client renders stay consistent.
  const brokerUrl = useMemo(() => process.env.NEXT_PUBLIC_BROKER_URL?.trim() ?? '', [])
  //2.- Track the status message that guides visitors through the setup flow.
  const [status, setStatus] = useState(DEFAULT_STATUS)

  useEffect(() => {
    //1.- Explain how to configure the broker when the environment variable is absent.
    if (!brokerUrl) {
      setStatus(
        'Broker URL missing. Create a .env.local file with NEXT_PUBLIC_BROKER_URL=ws://localhost:43127/ws to enable live telemetry.',
      )
      return () => {
        //1.- No runtime shell was started so only mark the effect as cancelled.
      }
    }
    //2.- Confirm to the player that the client is ready to negotiate a session.
    setStatus(`Client ready. Broker endpoint: ${brokerUrl}`)

    let cancelled = false
    let runtimeModule: typeof import('../../src/runtime/clientShell') | null = null

    const startShell = async () => {
      try {
        //3.- Lazily import the heavier runtime bundle so the landing page stays lightweight.
        runtimeModule = await import('../../src/runtime/clientShell')
        if (cancelled) {
          return
        }
        await runtimeModule.mountClientShell({ brokerUrl })
      } catch (error) {
        console.error('Failed to start client shell', error)
        if (!cancelled) {
          //4.- Surface a descriptive status message so the user can diagnose issues quickly.
          setStatus('Client shell failed to start. Check the developer console for details.')
        }
      }
    }

    startShell()

    return () => {
      //5.- Flag the effect as cancelled before unmounting to avoid racing asynchronous imports.
      cancelled = true
      if (runtimeModule) {
        runtimeModule.unmountClientShell()
      }
    }
  }, [brokerUrl])

  //3.- Present the bootstrap instructions alongside DOM anchors for future systems.
  return (
    <main>
      <section>
        <h1>Drift Pursuit Sandbox</h1>
        <p data-testid="status-message">{status}</p>
        <ol>
          <li>
            Start the broker server locally and expose the websocket endpoint (default
            <code> ws://localhost:43127/ws</code>).
          </li>
          <li>
            Create <code>.env.local</code> (use <code>scripts/setup-env.sh</code> for a starter file) and set NEXT_PUBLIC_BROKER_URL
            to the broker endpoint.
          </li>
          <li>Restart this page so the HUD connects using the configured broker URL.</li>
        </ol>
      </section>
      <section>
        <div id="canvas-root" aria-label="3D world mount" />
        <div id="hud-root" aria-label="HUD overlay mount" />
      </section>
      <SimulationControlPanel />
    </main>
  )
}
