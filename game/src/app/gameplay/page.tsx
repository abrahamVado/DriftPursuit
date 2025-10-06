'use client'

import { useEffect, useRef, useState } from 'react'
import { initGame, type GameAPI, DEFAULT_SCENE_OPTS } from '@/engine/bootstrap'
import { HUD } from '@/components/HUD'
import { LoadingOverlay } from '@/components/LoadingOverlay'

export const dynamic = 'force-dynamic'

export default function GameplayPage() {
  const mountRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<GameAPI | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!mountRef.current) return
    const { api, dispose } = initGame(mountRef.current, DEFAULT_SCENE_OPTS, () => setReady(true))
    apiRef.current = api
    return () => dispose()
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      {!ready && <LoadingOverlay />}
      <HUD getState={() => apiRef.current?.getState()} actions={() => apiRef.current?.actions} />
    </div>
  )
}
