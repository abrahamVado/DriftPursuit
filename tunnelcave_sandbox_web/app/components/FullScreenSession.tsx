'use client'

import React, { useEffect, useMemo, useState } from 'react'

import type { VehiclePresetName } from '../../src/world/procedural/vehicles'

interface FullScreenSessionProps {
  //1.- Optional pilot handle sourced from the shared session link.
  pilotName?: string
  //2.- Vehicle preset slug extracted from the share URL or defaulted by the page.
  vehicleId?: VehiclePresetName
}

const DEFAULT_VEHICLE: VehiclePresetName = 'arrowhead'

export default function FullScreenSession({ pilotName, vehicleId }: FullScreenSessionProps) {
  //1.- Resolve the broker URL once to avoid mismatched renders between server and client.
  const brokerUrl = useMemo(() => process.env.NEXT_PUBLIC_BROKER_URL?.trim() ?? '', [])
  //2.- Track the connection message surfaced to the player during session setup.
  const [status, setStatus] = useState('Preparing full-screen session…')

  useEffect(() => {
    //1.- Provide immediate guidance when the websocket endpoint is not configured yet.
    if (!brokerUrl) {
      setStatus('Broker URL missing. Set NEXT_PUBLIC_BROKER_URL to explore the infinite cave.')
      return () => {
        //1.- No shell was started so the cleanup routine simply exits.
      }
    }

    let cancelled = false
    let runtimeModule: typeof import('../../src/runtime/clientShell') | null = null

    const trimmedPilot = pilotName?.trim() ?? ''
    const resolvedPilot = trimmedPilot || 'sandbox-player'
    const resolvedVehicle = vehicleId ?? DEFAULT_VEHICLE

    //2.- Update the banner so visitors know which identity is connecting to the broker.
    setStatus(`Connecting to ${brokerUrl} as ${resolvedPilot}. Vehicle: ${resolvedVehicle}`)

    const startShell = async () => {
      try {
        //3.- Lazily import the client shell so the landing route stays responsive.
        runtimeModule = await import('../../src/runtime/clientShell')
        if (cancelled) {
          return
        }
        await runtimeModule.mountClientShell({
          brokerUrl,
          playerProfile: { pilotName: trimmedPilot, vehicleId: resolvedVehicle },
        })
        if (!cancelled) {
          //4.- Confirm the runtime finished mounting once telemetry streams become available.
          setStatus(`Connected to ${brokerUrl} as ${resolvedPilot}. Vehicle: ${resolvedVehicle}`)
        }
      } catch (error) {
        console.error('Failed to start full-screen client shell', error)
        if (!cancelled) {
          //5.- Expose a descriptive failure notice so operators can diagnose quickly.
          setStatus('Client shell failed to start. Check the developer console for details.')
        }
      }
    }

    startShell()

    return () => {
      //6.- Prevent stale effects from mutating state and ensure resources are released.
      cancelled = true
      if (runtimeModule) {
        runtimeModule.unmountClientShell()
      }
    }
  }, [brokerUrl, pilotName, vehicleId])

  return (
    <div className="full-session">
      <div className="full-session__stage">
        <div id="canvas-root" aria-label="Full-screen world mount" className="full-session__canvas-root" />
        <div id="hud-root" aria-label="Full-screen HUD mount" className="full-session__hud-root" />
        <div className="full-session__status" data-testid="full-session-status">
          {status}
        </div>
      </div>
    </div>
  )
}
