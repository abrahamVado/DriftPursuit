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
    let cancelled = false
    let runtimeModule: typeof import('../../src/runtime/clientShell') | null = null
    let previewCleanup: (() => void) | null = null

    const teardownPreview = () => {
      //1.- Dispose the offline preview renderer when the main shell supersedes it.
      if (previewCleanup) {
        previewCleanup()
        previewCleanup = null
      }
    }

    const ensurePreview = async (reason: 'missing-broker' | 'shell-failed') => {
      //2.- Lazily construct the offline preview so users always see the cave geometry.
      if (cancelled || previewCleanup) {
        return
      }
      try {
        const { startOfflineCavePreview } = await import('./OfflineCavePreview')
        const canvasRoot = document.getElementById('canvas-root')
        if (!canvasRoot) {
          return
        }
        previewCleanup = startOfflineCavePreview({ canvasRoot })
        if (reason === 'missing-broker') {
          setStatus('Previewing the infinite cave while the broker URL is configured.')
        } else {
          setStatus('Client shell failed. Showing the offline infinite cave preview.')
        }
      } catch (error) {
        console.error('Failed to start offline cave preview', error)
      }
    }

    const trimmedPilot = pilotName?.trim() ?? ''
    const resolvedPilot = trimmedPilot || 'sandbox-player'
    const resolvedVehicle = vehicleId ?? DEFAULT_VEHICLE

    if (!brokerUrl) {
      //3.- Fall back to the offline preview whenever the live broker endpoint is absent.
      ensurePreview('missing-broker')
      return () => {
        cancelled = true
        teardownPreview()
      }
    }

    //4.- Update the banner so visitors know which identity is connecting to the broker.
    setStatus(`Connecting to ${brokerUrl} as ${resolvedPilot}. Vehicle: ${resolvedVehicle}`)

    const startShell = async () => {
      try {
        //5.- Lazily import the client shell so the landing route stays responsive.
        runtimeModule = await import('../../src/runtime/clientShell')
        if (cancelled) {
          return
        }
        teardownPreview()
        const mounted = await runtimeModule.mountClientShell({
          brokerUrl,
          playerProfile: { pilotName: trimmedPilot, vehicleId: resolvedVehicle },
        })
        if (!cancelled && mounted) {
          //6.- Confirm the runtime finished mounting once telemetry streams become available.
          setStatus(`Connected to ${brokerUrl} as ${resolvedPilot}. Vehicle: ${resolvedVehicle}`)
        }
      } catch (error) {
        console.error('Failed to start full-screen client shell', error)
        if (!cancelled) {
          runtimeModule?.unmountClientShell()
          await ensurePreview('shell-failed')
        }
      }
    }

    startShell()

    return () => {
      //7.- Prevent stale effects from mutating state and ensure resources are released.
      cancelled = true
      teardownPreview()
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
