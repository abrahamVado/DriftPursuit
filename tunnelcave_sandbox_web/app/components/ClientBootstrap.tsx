'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'

import SimulationControlPanel from './SimulationControlPanel'
import SessionLaunchPanel from './SessionLaunchPanel'
import type { VehiclePresetName } from '../../src/world/procedural/vehicles'

const DEFAULT_STATUS = 'Loading web client shell…'
const AVAILABLE_VEHICLES: VehiclePresetName[] = ['arrowhead', 'aurora', 'duskfall', 'steelwing']

export default function ClientBootstrap() {
  //1.- Capture the broker URL once so hydration and client renders stay consistent.
  const brokerUrl = useMemo(() => process.env.NEXT_PUBLIC_BROKER_URL?.trim() ?? '', [])
  //2.- Track the status message that guides visitors through the setup flow.
  const [status, setStatus] = useState(DEFAULT_STATUS)
  //3.- Track the committed pilot handle so the runtime can negotiate a personalised broker subject.
  const [playerName, setPlayerName] = useState('')
  //4.- Track the committed vehicle preset to showcase the correct craft in the idle renderer.
  const [vehicleId, setVehicleId] = useState<VehiclePresetName>('arrowhead')
  //5.- Maintain draft lobby state so visitors can stage selections before reconfiguring the runtime.
  const [playerNameDraft, setPlayerNameDraft] = useState('')
  const [vehicleIdDraft, setVehicleIdDraft] = useState<VehiclePresetName>('arrowhead')

  const hydrateFromLocation = useCallback(() => {
    //1.- Derive lobby configuration from the query string so shared URLs restore the state.
    if (typeof window === 'undefined') {
      return
    }
    const url = new URL(window.location.href)
    const pilotParam = url.searchParams.get('pilot')?.trim() ?? ''
    const vehicleParam = (url.searchParams.get('vehicle') ?? '').trim().toLowerCase() as VehiclePresetName
    const resolvedVehicle = vehicleParam && AVAILABLE_VEHICLES.includes(vehicleParam) ? vehicleParam : undefined
    if (pilotParam) {
      setPlayerName(pilotParam)
      setPlayerNameDraft(pilotParam)
    }
    if (resolvedVehicle) {
      setVehicleId(resolvedVehicle)
      setVehicleIdDraft(resolvedVehicle)
    }
  }, [])

  useEffect(() => {
    //1.- Populate lobby state from the current URL when the component hydrates on the client.
    hydrateFromLocation()
  }, [hydrateFromLocation])

  const updateUrlWithLobby = useCallback(
    (name: string, vehicle: VehiclePresetName) => {
      //1.- Synchronise the query string with the current lobby selections for sharing purposes.
      if (typeof window === 'undefined') {
        return
      }
      const url = new URL(window.location.href)
      const trimmed = name.trim()
    if (trimmed) {
      url.searchParams.set('pilot', trimmed)
    } else {
      url.searchParams.delete('pilot')
    }
    url.searchParams.set('vehicle', vehicle)
    try {
      window.history.replaceState(null, '', url.toString())
    } catch (error) {
      //2.- Surface a warning during development instead of aborting when history APIs reject the update.
      console.warn('Failed to update share URL', error)
    }
    },
    [],
  )

  const shareUrl = useMemo(() => {
    //1.- Generate the share link using the current browser location and lobby selections.
    if (typeof window === 'undefined') {
      return ''
    }
    const url = new URL(window.location.href)
    const trimmed = playerNameDraft.trim()
    if (trimmed) {
      url.searchParams.set('pilot', trimmed)
    } else {
      url.searchParams.delete('pilot')
    }
    url.searchParams.set('vehicle', vehicleIdDraft)
    return url.toString()
  }, [playerNameDraft, vehicleIdDraft])

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
    const subject = playerName.trim() || 'sandbox-player'
    setStatus(`Client ready. Broker endpoint: ${brokerUrl}. Pilot: ${subject}. Vehicle: ${vehicleId}`)

    let cancelled = false
    let runtimeModule: typeof import('../../src/runtime/clientShell') | null = null

    const startShell = async () => {
      try {
        //3.- Lazily import the heavier runtime bundle so the landing page stays lightweight.
        runtimeModule = await import('../../src/runtime/clientShell')
        if (cancelled) {
          return
        }
        await runtimeModule.mountClientShell({
          brokerUrl,
          playerProfile: { pilotName: playerName, vehicleId },
        })
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
  }, [brokerUrl, playerName, vehicleId])

  const handleStart = useCallback(() => {
    //1.- Commit the draft selections to the runtime and persist them to the URL for sharing.
    setPlayerName(playerNameDraft)
    setVehicleId(vehicleIdDraft)
    updateUrlWithLobby(playerNameDraft, vehicleIdDraft)
  }, [playerNameDraft, updateUrlWithLobby, vehicleIdDraft])

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
      <SessionLaunchPanel
        playerName={playerNameDraft}
        vehicleId={vehicleIdDraft}
        onPlayerNameChange={setPlayerNameDraft}
        onVehicleIdChange={(value) => setVehicleIdDraft(value)}
        onStart={handleStart}
        shareUrl={shareUrl}
      />
      <section>
        <div id="canvas-root" aria-label="3D world mount" />
        <div id="hud-root" aria-label="HUD overlay mount" />
      </section>
      <SimulationControlPanel />
    </main>
  )
}
