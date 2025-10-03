'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CONTROL_PANEL_EVENT,
  type ControlPanelIntentDetail,
} from '../../../typescript-client/src/world/controlPanelEvents'

type CommandName = 'throttle' | 'brake'

type PanelProps = {
  baseUrl?: string
}

const DEFAULT_STATUS = 'Simulation bridge offline.'
const CONFIG_HINT = 'Set NEXT_PUBLIC_SIM_BRIDGE_URL (e.g. http://localhost:8000) to enable interactive control.'

export default function SimulationControlPanel({ baseUrl }: PanelProps) {
  //1.- Resolve the bridge base URL lazily so runtime overrides and props are respected.
  const resolvedBaseUrl = useMemo(() => {
    const candidate = baseUrl ?? process.env.NEXT_PUBLIC_SIM_BRIDGE_URL ?? ''
    return candidate.trim()
  }, [baseUrl])
  //2.- Track status and error messages so the UI communicates connection progress.
  const [status, setStatus] = useState(DEFAULT_STATUS)
  const [error, setError] = useState('')
  const [lastCommand, setLastCommand] = useState('none')

  useEffect(() => {
    //1.- Abort early when the bridge URL is not configured to avoid failing network calls.
    if (!resolvedBaseUrl) {
      setStatus(DEFAULT_STATUS)
      setError(CONFIG_HINT)
      return
    }
    let cancelled = false
    const controller = new AbortController()
    //2.- Notify the user that the handshake negotiation has started.
    setStatus('Negotiating with simulation bridge…')
    setError('')
    //3.- Attempt to fetch the handshake payload from the bridge server.
    fetch(`${resolvedBaseUrl}/handshake`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Handshake failed with status ${response.status}`)
        }
        return response.json()
      })
      .then((payload: { message?: string }) => {
        if (cancelled) {
          return
        }
        setStatus(payload.message ?? 'Simulation bridge online')
        setError('')
      })
      .catch((reason: Error) => {
        if (cancelled) {
          return
        }
        setStatus(DEFAULT_STATUS)
        setError(`Handshake error: ${reason.message}`)
      })
    //4.- Clean up the pending request if the component unmounts during negotiation.
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [resolvedBaseUrl])

  const sendCommand = useCallback(
    async (command: CommandName) => {
      //1.- Prevent command dispatches when the bridge URL has not been configured yet.
      if (!resolvedBaseUrl) {
        setError(CONFIG_HINT)
        return
      }
      try {
        setError('')
        const response = await fetch(`${resolvedBaseUrl}/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command, issuedAtMs: Date.now() }),
        })
        if (!response.ok) {
          throw new Error(`Command failed with status ${response.status}`)
        }
        const payload = await response.json()
        setLastCommand(payload.command?.command ?? command)
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Unknown error'
        setError(`Command error: ${message}`)
      }
    },
    [resolvedBaseUrl],
  )

  const emitControlIntent = useCallback((command: CommandName) => {
    //1.- Forward UI interactions as DOM events so other subsystems can mirror HTTP commands.
    const target: EventTarget | null =
      typeof window !== 'undefined'
        ? window
        : typeof document !== 'undefined'
          ? document
          : null
    if (!target) {
      return
    }
    const detail: ControlPanelIntentDetail = {
      control: command,
      value: 1,
      issuedAtMs: Date.now(),
    }
    target.dispatchEvent(new CustomEvent(CONTROL_PANEL_EVENT, { detail }))
  }, [])

  const handleControl = useCallback(
    (command: CommandName) => {
      emitControlIntent(command)
      void sendCommand(command)
    },
    [emitControlIntent, sendCommand],
  )

  //3.- Render the control panel with buttons that dispatch commands to the simulation bridge.
  return (
    <section aria-label="Simulation control panel">
      <h2>Simulation Bridge</h2>
      <p data-testid="bridge-status">{status}</p>
      {error ? (
        <p role="alert" data-testid="bridge-error">
          {error}
        </p>
      ) : null}
      <div>
        <button type="button" onClick={() => handleControl('throttle')}>
          Throttle
        </button>
        <button type="button" onClick={() => handleControl('brake')}>
          Brake
        </button>
      </div>
      <p data-testid="last-command">Last command: {lastCommand}</p>
    </section>
  )
}
