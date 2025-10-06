'use client'

import React, { useMemo } from 'react'

import BattlefieldCanvas from '../BattlefieldCanvas'
import { generateBattlefield } from '../generateBattlefield'
import { createPlayerSessionId } from '../playerSession'
import { VEHICLE_IDS } from '../vehicles'
import { SHARED_WORLD_SEED } from '../worldLobby'

const DEFAULT_EXPLORER_NAME = 'Cavern Explorer'
const DEFAULT_EXPLORER_VEHICLE = VEHICLE_IDS[0]

export default function WorldExplorerPage() {
  //1.- Memoise the battlefield so the free-roam scene remains stable between re-renders.
  const battlefield = useMemo(() => generateBattlefield(SHARED_WORLD_SEED), [])
  //2.- Allocate a light-weight spectator identifier to satisfy systems expecting a session id.
  const sessionId = useMemo(() => createPlayerSessionId(), [])

  return (
    <main className="world-explorer-layout" data-testid="world-explorer-page">
      <header className="world-explorer-intro">
        <h1>World Explorer</h1>
        <p>
          Drift freely through the shared cavern without committing to the combat roster. This sandbox loads
          instantly with a spectator handle so you can focus on surveying the landscape.
        </p>
      </header>
      <section aria-label="Free roam canvas" className="world-explorer-canvas" data-testid="world-explorer-canvas">
        {/* //3.- Mount the same battlefield renderer but seed it with a default spectator profile. */}
        <BattlefieldCanvas
          config={battlefield}
          playerName={DEFAULT_EXPLORER_NAME}
          sessionId={sessionId}
          vehicleId={DEFAULT_EXPLORER_VEHICLE}
        />
      </section>
    </main>
  )
}
