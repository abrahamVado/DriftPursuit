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

    //1.- Bootstrap the local scene graph and retain the exposed API for downstream broker synchronisation.
    const { api, dispose } = initGame(
      mountRef.current,
      DEFAULT_SCENE_OPTS,
      () => setReady(true),
      { initialVehicle: pilotProfile.vehicle, pilotId: pilotProfile.clientId }
    )
    apiRef.current = api

    //2.- Connect to the broker so authoritative world diffs can steer the HUD and server-side actors.
    const broker = createBrokerClient({ clientId: pilotProfile.clientId })
    const unsubscribe = broker.onWorldDiff((diff) => {
      apiRef.current?.ingestWorldDiff(diff)
    })

    //3.- Stream the player's latest inputs back to the broker on a short cadence.
    let stopped = false
    let intentTimer: ReturnType<typeof setTimeout> | null = null
    const pumpIntent = () => {
      if (stopped) return
      const snapshot = apiRef.current?.sampleIntent()
      if (snapshot) {
        broker.sendIntent(snapshot)
      }
      intentTimer = setTimeout(pumpIntent, 100)
    }
    pumpIntent()

    //4.- Mirror the local pilot over a BroadcastChannel so parallel tabs manifest as remote players.
    const presence = createPresenceChannel({ clientId: pilotProfile.clientId })
    const unsubscribePresence = presence.subscribe((message) => {
      if (message.type === 'update') {
        apiRef.current?.ingestPresenceSnapshot(message.snapshot)
      } else if (message.type === 'leave') {
        apiRef.current?.removeRemoteVehicle(message.vehicleId)
      }
    })
    let presenceTimer: ReturnType<typeof setTimeout> | null = null
    const pumpPresence = () => {
      if (stopped) return
      const snapshot = apiRef.current?.samplePresence()
      if (snapshot) {
        presence.publish(snapshot)
      }
      presenceTimer = setTimeout(pumpPresence, 150)
    }
    pumpPresence()

    const announceDeparture = () => {
      const snapshot = apiRef.current?.samplePresence()
      presence.announceDeparture(snapshot?.vehicle_id ?? pilotProfile.clientId)
    }
    window.addEventListener('beforeunload', announceDeparture)

    return () => {
      stopped = true
      if (intentTimer) clearTimeout(intentTimer)
      if (presenceTimer) clearTimeout(presenceTimer)
      unsubscribe()
      broker.close()
      announceDeparture()
      unsubscribePresence()
      presence.close()
      window.removeEventListener('beforeunload', announceDeparture)
      dispose()
    }
  }, [pilotProfile.clientId, pilotProfile.vehicle])

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      {!ready && <LoadingOverlay />}
      <HUD getState={() => apiRef.current?.getState()} actions={() => apiRef.current?.actions} />
    </div>
  )
}
