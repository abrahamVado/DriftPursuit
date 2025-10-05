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

type PreviewReason = 'initialising' | 'missing-broker' | 'shell-failed' | 'passive-shell'

export default function FullScreenSession({ pilotName, vehicleId }: FullScreenSessionProps) {
  //1.- Resolve the broker URL once to avoid mismatched renders between server and client.
  const brokerUrl = useMemo(() => process.env.NEXT_PUBLIC_BROKER_URL?.trim() ?? '', [])
  //2.- Track the connection message surfaced to the player during session setup.
  const [status, setStatus] = useState('Preparing full-screen session…')

  useEffect(() => {
    let cancelled = false
    let runtimeModule: typeof import('../../src/runtime/clientShell') | null = null
    let previewCleanup: (() => void) | null = null

    const updateStatusForReason = (reason: PreviewReason) => {
      //1.- Surface contextual status updates that explain the current preview state.
      switch (reason) {
        case 'initialising':
          setStatus('Launching the infinite cave preview while the client connects…')
          break
        case 'missing-broker':
          setStatus('Previewing the infinite cave while the broker URL is configured.')
          break
        case 'shell-failed':
          setStatus('Client shell failed. Showing the offline infinite cave preview.')
          break
        case 'passive-shell':
          setStatus('Live session unavailable. Continuing the offline infinite cave preview.')
          break
      }
    }

    const teardownPreview = () => {
      //1.- Dispose the offline preview renderer when the main shell supersedes it.
      if (previewCleanup) {
        previewCleanup()
        previewCleanup = null
      }
    }

    const ensurePreview = async (reason: PreviewReason) => {
      //2.- Lazily construct the offline preview so users always see the cave geometry.
      if (cancelled) {
        return
      }
      if (previewCleanup) {
        updateStatusForReason(reason)
        return
      }
      try {
        const { startOfflineCavePreview } = await import('./OfflineCavePreview')
        const canvasRoot = document.getElementById('canvas-root')
        if (!canvasRoot) {
          return
        }
        if (cancelled) {
          return
        }
        previewCleanup = startOfflineCavePreview({ canvasRoot })
        updateStatusForReason(reason)
      } catch (error) {
        console.error('Failed to start offline cave preview', error)
      }
    }

    const run = async () => {
      //3.- Begin with the offline preview so visitors always see the infinite cave immediately.
      await ensurePreview('initialising')

      const trimmedPilot = pilotName?.trim() ?? ''
      const resolvedPilot = trimmedPilot || 'sandbox-player'
      const resolvedVehicle = vehicleId ?? DEFAULT_VEHICLE

      if (!brokerUrl) {
        //4.- Fall back to the offline preview whenever the live broker endpoint is absent.
        await ensurePreview('missing-broker')
        return
      }

      //5.- Update the banner so visitors know which identity is connecting to the broker.
      setStatus(`Connecting to ${brokerUrl} as ${resolvedPilot}. Vehicle: ${resolvedVehicle}`)

      try {
        //6.- Lazily import the client shell so the landing route stays responsive.
        runtimeModule = await import('../../src/runtime/clientShell')
        if (cancelled) {
          return
        }
        const mountResult = await runtimeModule.mountClientShell({
          brokerUrl,
          playerProfile: { pilotName: trimmedPilot, vehicleId: resolvedVehicle },
        })
        if (cancelled) {
          return
        }
        if (mountResult === 'active') {
          //7.- Confirm the runtime finished mounting once telemetry streams become available.
          teardownPreview()
          setStatus(`Connected to ${brokerUrl} as ${resolvedPilot}. Vehicle: ${resolvedVehicle}`)
        } else {
          runtimeModule.unmountClientShell()
          await ensurePreview('passive-shell')
        }
      } catch (error) {
        console.error('Failed to start full-screen client shell', error)
        if (!cancelled) {
          runtimeModule?.unmountClientShell()
          await ensurePreview('shell-failed')
        }
      }
    }

    run()

    return () => {
      //8.- Prevent stale effects from mutating state and ensure resources are released.
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
