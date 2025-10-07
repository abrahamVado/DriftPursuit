'use client'

import { useEffect, useRef, useState } from 'react'
import { initGame, type GameAPI, DEFAULT_SCENE_OPTS } from '@/engine/bootstrap'
import { createBrokerClient } from '@/lib/brokerClient'
import { HUD } from '@/components/HUD'
import { LoadingOverlay } from '@/components/LoadingOverlay'

export const dynamic = 'force-dynamic'

export default function GameplayPage() {
  const mountRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<GameAPI | null>(null)
  const [ready, setReady] = useState(false)
  const [clientId] = useState(() => {
    //1.- Derive a stable yet unique identifier so parallel browser sessions do not collide on the broker bus.
    const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
    return `pilot-${uuid}`
  })

  useEffect(() => {
    if (!mountRef.current) return

    //1.- Bootstrap the local scene graph and retain the exposed API for downstream broker synchronisation.
    const { api, dispose } = initGame(mountRef.current, DEFAULT_SCENE_OPTS, () => setReady(true))
    apiRef.current = api

    //2.- Connect to the broker so authoritative world diffs can steer the HUD and server-side actors.
    const broker = createBrokerClient({ clientId })
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

    return () => {
      stopped = true
      if (intentTimer) clearTimeout(intentTimer)
      unsubscribe()
      broker.close()
      dispose()
    }
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      {!ready && <LoadingOverlay />}
      <HUD getState={() => apiRef.current?.getState()} actions={() => apiRef.current?.actions} />
    </div>
  )
}
