'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { initGame, type GameAPI, DEFAULT_SCENE_OPTS } from '@/engine/bootstrap'
import { createBrokerClient } from '@/lib/brokerClient'
import { HUD } from '@/components/HUD'
import { LoadingOverlay } from '@/components/LoadingOverlay'
import { createPilotProfile } from '@/lib/pilotProfile'
import { createPresenceChannel } from '@/lib/presenceChannel'

export const dynamic = 'force-dynamic'

export default function GameplayPage() {
  const mountRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<GameAPI | null>(null)
  const [ready, setReady] = useState(false)
  const searchParams = useSearchParams()
  const pilotProfile = useMemo(() => {
    return createPilotProfile({
      name: searchParams?.get('pilot'),
      vehicle: searchParams?.get('vehicle')
    })
  }, [searchParams])

  useEffect(() => {
    if (!mountRef.current) return

    setReady(false)

    //1.- Maintain lifecycle guards so timers, subscriptions, and the scene graph unwind cleanly during teardown.
    let started = false
    let stopped = false
    let intentTimer: ReturnType<typeof setTimeout> | null = null
    let presenceTimer: ReturnType<typeof setTimeout> | null = null
    let unsubscribeWorldDiff: (() => void) | null = null
    let unsubscribeWorldStatus: (() => void) | null = null
    let unsubscribePresence: (() => void) | null = null
    let disposeGame: (() => void) | null = null
    let presence: ReturnType<typeof createPresenceChannel> | null = null
    let beforeUnloadBound = false
    let announceDeparture: () => void = () => {}

    //2.- Establish the broker connection immediately so the world status handshake can arrive before the scene spins up.
    const broker = createBrokerClient({
      clientId: pilotProfile.clientId,
      pilotProfile: { name: pilotProfile.name, vehicle: pilotProfile.vehicle }
    })

    const stopIntentPump = () => {
      if (intentTimer) {
        clearTimeout(intentTimer)
        intentTimer = null
      }
    }
    const stopPresencePump = () => {
      if (presenceTimer) {
        clearTimeout(presenceTimer)
        presenceTimer = null
      }
    }

    const beginScene = (status: { worldId: string; mapId: string }) => {
      if (started || !mountRef.current) {
        return
      }
      started = true
      unsubscribeWorldStatus?.()
      unsubscribeWorldStatus = null

      //3.- Bootstrap the local scene graph once the broker reveals the deterministic world identifiers.
      const { api, dispose } = initGame(
        mountRef.current,
        DEFAULT_SCENE_OPTS,
        () => setReady(true),
        {
          initialVehicle: pilotProfile.vehicle,
          pilotId: pilotProfile.clientId,
          worldId: status.worldId,
          mapId: status.mapId
        }
      )
      apiRef.current = api
      disposeGame = dispose

      //4.- Mirror authoritative world diffs and intention frames through the freshly initialised API surface.
      unsubscribeWorldDiff = broker.onWorldDiff((diff) => {
        apiRef.current?.ingestWorldDiff(diff)
      })

      const pumpIntent = () => {
        if (stopped) return
        const snapshot = apiRef.current?.sampleIntent()
        if (snapshot) {
          broker.sendIntent(snapshot)
        }
        intentTimer = setTimeout(pumpIntent, 100)
      }
      pumpIntent()

      //5.- Broadcast local pilot presence so sibling tabs can project this client as a remote craft.
      presence = createPresenceChannel({ clientId: pilotProfile.clientId })
      unsubscribePresence = presence.subscribe((message) => {
        if (message.type === 'update') {
          apiRef.current?.ingestPresenceSnapshot(message.snapshot)
        } else if (message.type === 'leave') {
          apiRef.current?.removeRemoteVehicle(message.vehicleId)
        }
      })

      const pumpPresence = () => {
        if (stopped) return
        const snapshot = apiRef.current?.samplePresence()
        if (snapshot) {
          presence?.publish(snapshot)
        }
        presenceTimer = setTimeout(pumpPresence, 150)
      }
      pumpPresence()

      announceDeparture = () => {
        const snapshot = apiRef.current?.samplePresence()
        presence?.announceDeparture(snapshot?.vehicle_id ?? pilotProfile.clientId)
      }
      window.addEventListener('beforeunload', announceDeparture)
      beforeUnloadBound = true
    }

    unsubscribeWorldStatus = broker.onWorldStatus((status) => {
      beginScene(status)
    })

    return () => {
      stopped = true
      stopIntentPump()
      stopPresencePump()
      unsubscribeWorldDiff?.()
      unsubscribeWorldStatus?.()
      broker.close()
      if (started) {
        announceDeparture()
      }
      unsubscribePresence?.()
      presence?.close()
      if (beforeUnloadBound) {
        window.removeEventListener('beforeunload', announceDeparture)
      }
      disposeGame?.()
    }
  }, [pilotProfile.clientId, pilotProfile.name, pilotProfile.vehicle])

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      {!ready && <LoadingOverlay />}
      <HUD getState={() => apiRef.current?.getState()} actions={() => apiRef.current?.actions} />
    </div>
  )
}
