'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'

import type { VehiclePresetName } from '../../src/world/procedural/vehicles'

interface SessionLaunchPanelProps {
  //1.- Current pilot handle supplied by the hosting bootstrap component.
  playerName: string
  //2.- Currently selected vehicle preset identifier.
  vehicleId: VehiclePresetName
  //3.- Callback invoked when the pilot updates their chosen handle.
  onPlayerNameChange: (name: string) => void
  //4.- Callback invoked when the pilot selects a different vehicle preset.
  onVehicleIdChange: (vehicle: VehiclePresetName) => void
  //5.- Callback fired when the pilot confirms they are ready to enter the session.
  onStart: () => void
  //6.- Shareable session URL generated from the current lobby configuration.
  shareUrl?: string
}

const VEHICLE_LABELS: Record<VehiclePresetName, string> = {
  //1.- Provide approachable names for each preset so the lobby feels inviting.
  arrowhead: 'Arrowhead Interceptor',
  aurora: 'Aurora Glider',
  duskfall: 'Duskfall Raider',
  steelwing: 'Steelwing Vanguard',
}

export default function SessionLaunchPanel({
  playerName,
  vehicleId,
  onPlayerNameChange,
  onVehicleIdChange,
  onStart,
  shareUrl,
}: SessionLaunchPanelProps) {
  //1.- Track whether the share link has been copied so feedback can be surfaced inline.
  const [copyFeedback, setCopyFeedback] = useState('')

  useEffect(() => {
    //1.- Reset the copy feedback whenever the share URL changes to avoid stale hints.
    setCopyFeedback('')
  }, [shareUrl])

  const handleCopyShareUrl = useCallback(async () => {
    //1.- Abort if the share link is unavailable or empty.
    if (!shareUrl) {
      setCopyFeedback('Share link unavailable. Configure the lobby first.')
      return
    }
    try {
      if (navigator.clipboard?.writeText) {
        //2.- Prefer the asynchronous clipboard API when supported by the browser.
        await navigator.clipboard.writeText(shareUrl)
      } else {
        //3.- Fallback to a temporary textarea strategy for legacy environments.
        const textarea = document.createElement('textarea')
        textarea.value = shareUrl
        textarea.setAttribute('readonly', 'true')
        textarea.style.position = 'absolute'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        textarea.remove()
      }
      setCopyFeedback('Share link copied to clipboard!')
    } catch (error) {
      console.warn('Failed to copy share link', error)
      setCopyFeedback('Copy failed. Select and copy the link manually.')
    }
  }, [shareUrl])

  const shareLinkValue = useMemo(() => shareUrl ?? '', [shareUrl])

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      //1.- Prevent the browser from performing a full page reload.
      event.preventDefault()
      onStart()
    },
    [onStart],
  )

  return (
    <section aria-label="Session lobby">
      <h2>Join the Cave Run</h2>
      <p>
        Configure your pilot handle and preferred craft, then share the invite link so friends can dive into the
        cavern with you.
      </p>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="pilot-name">Pilot Handle</label>
          <input
            id="pilot-name"
            name="pilot"
            type="text"
            value={playerName}
            onChange={(event) => onPlayerNameChange(event.target.value)}
            placeholder="e.g. Aurora Rider"
            data-testid="pilot-name-input"
          />
        </div>
        <div>
          <label htmlFor="vehicle-select">Vehicle</label>
          <select
            id="vehicle-select"
            name="vehicle"
            value={vehicleId}
            onChange={(event) => onVehicleIdChange(event.target.value as VehiclePresetName)}
            data-testid="vehicle-select"
          >
            {Object.entries(VEHICLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="share-url">Session Share Link</label>
          <input
            id="share-url"
            name="share-url"
            type="url"
            value={shareLinkValue}
            readOnly
            data-testid="share-url"
          />
          <button type="button" onClick={handleCopyShareUrl} data-testid="copy-share-url">
            Copy Link
          </button>
          {copyFeedback ? <p data-testid="copy-feedback">{copyFeedback}</p> : null}
        </div>
        <div>
          <button type="submit" data-testid="start-session-button">
            Start Session
          </button>
        </div>
      </form>
    </section>
  )
}
