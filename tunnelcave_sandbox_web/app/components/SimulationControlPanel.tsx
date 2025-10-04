'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CONTROL_PANEL_EVENT,
  type ControlPanelIntentDetail,
} from '@client/world/controlPanelEvents'

type CommandName = 'throttle' | 'brake'

type PanelProps = {
  baseUrl?: string
}

const DEFAULT_STATUS = 'Simulation bridge offline.'
const CONFIG_HINT =
  'Set SIM_BRIDGE_URL or NEXT_PUBLIC_SIM_BRIDGE_URL (e.g. http://localhost:8000) to enable interactive control.'

export default function SimulationControlPanel({ baseUrl }: PanelProps) {
  //1.- Resolve a direct override so tests and same-origin deployments can bypass the API proxy.
  const overrideBaseUrl = useMemo(() => {
    const candidate = baseUrl ?? ''
    return candidate.trim()
  }, [baseUrl])
  //2.- Capture the environment-provided bridge URL when no explicit override has been supplied.
  const envBaseUrl = useMemo(() => {
    if (overrideBaseUrl) {
      return ''
    }
    const candidate = process.env.NEXT_PUBLIC_SIM_BRIDGE_URL ?? ''
    return candidate.trim()
  }, [overrideBaseUrl])
  //3.- Compute the handshake endpoint, favouring the API proxy when only the environment variable is available.
  const handshakeUrl = useMemo(() => {
    if (overrideBaseUrl) {
      return `${overrideBaseUrl}/handshake`
    }
    if (envBaseUrl) {
      return '/api/sim-bridge/handshake'
    }
    return ''
  }, [envBaseUrl, overrideBaseUrl])
  //6.- Precompute the most useful handshake target so logs can surface the expected upstream endpoint.
  const resolvedHandshakeTarget = useMemo(() => {
    return [overrideBaseUrl, envBaseUrl, handshakeUrl].find(
      (candidate): candidate is string => Boolean(candidate),
    )
  }, [envBaseUrl, handshakeUrl, overrideBaseUrl])
  //4.- Compute the command endpoint, mirroring the handshake URL selection logic.
  const commandUrl = useMemo(() => {
    if (overrideBaseUrl) {
      return `${overrideBaseUrl}/command`
    }
    if (envBaseUrl) {
      return '/api/sim-bridge/command'
    }
    return ''
  }, [envBaseUrl, overrideBaseUrl])
  //5.- Track status and error messages so the UI communicates connection progress.
  const [status, setStatus] = useState(DEFAULT_STATUS)
  const [error, setError] = useState('')
  const [lastCommand, setLastCommand] = useState('none')

  useEffect(() => {
    //1.- Abort early when the bridge URL is not configured to avoid failing network calls.
    if (!handshakeUrl) {
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
    const logTarget = resolvedHandshakeTarget ?? ''
    if (logTarget) {
      console.info('[SimulationControlPanel] Attempting simulation bridge handshake via %s', logTarget)
    }
    fetch(handshakeUrl, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) {
          const message = typeof payload?.message === 'string' ? payload.message : `Handshake failed with status ${response.status}`
          throw new Error(message)
        }
        return payload
      })
      .then((payload: { message?: string; bridgeUrl?: string }) => {
        if (cancelled) {
          return
        }
        //4.- Surface the resolved Go simulation bridge URL so operators can confirm the upstream endpoint.
        const upstreamBridgeUrl = [payload.bridgeUrl, logTarget, handshakeUrl].find(
          (candidate): candidate is string => Boolean(candidate),
        )
        if (upstreamBridgeUrl) {
          console.info('[SimulationControlPanel] Simulation bridge handshake succeeded via %s', upstreamBridgeUrl)
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
        if (logTarget) {
          console.warn(
            '[SimulationControlPanel] Simulation bridge handshake failed via %s: %s',
            logTarget,
            reason.message,
          )
        } else {
          console.warn(
            '[SimulationControlPanel] Simulation bridge handshake failed: %s',
            reason.message,
          )
        }
      })
    //5.- Clean up the pending request if the component unmounts during negotiation.
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [handshakeUrl, resolvedHandshakeTarget])

  const sendCommand = useCallback(
    async (command: CommandName) => {
      //1.- Prevent command dispatches when the bridge URL has not been configured yet.
      if (!commandUrl) {
        setError(CONFIG_HINT)
        return
      }
      try {
        setError('')
        const response = await fetch(commandUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command, issuedAtMs: Date.now() }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          const message = typeof payload?.message === 'string' ? payload.message : `Command failed with status ${response.status}`
          throw new Error(message)
        }
        setLastCommand(payload.command?.command ?? command)
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Unknown error'
        setError(`Command error: ${message}`)
      }
    },
    [commandUrl],
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
