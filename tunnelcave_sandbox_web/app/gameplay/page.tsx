'use client'

import React from 'react'
import { useMemo, useState } from 'react'

import BattlefieldCanvas from './BattlefieldCanvas'
import PlanetaryMapPanel from './planetSandbox/PlanetaryMapPanel'
import { generateBattlefield } from './generateBattlefield'
import { createPlayerSessionId } from './playerSession'
import { VEHICLE_IDS, type VehicleId } from './vehicles'
import { SHARED_WORLD_SEED } from './worldLobby'

export type VehicleOption = VehicleId

export default function GameplayPage() {
  //1.- Track the progression through the join flow so the interface reveals the correct controls.
  const [stage, setStage] = useState<'initial' | 'lobby' | 'battle'>('initial')
  //2.- Capture the player's chosen callsign and vehicle to seed the session.
  const [playerName, setPlayerName] = useState('')
  const [vehicleId, setVehicleId] = useState<VehicleOption>('arrowhead')
  const [nameError, setNameError] = useState('')
  //3.- Generate the procedural battlefield once so re-renders preserve the map layout.
  const battlefield = useMemo(() => generateBattlefield(SHARED_WORLD_SEED), [])
  //4.- Allocate a session identifier per tab load to satisfy the unique player requirement.
  const sessionId = useMemo(() => createPlayerSessionId(), [])

  const handleJoin = () => {
    //1.- Transition to the lobby state and present selection controls.
    setStage('lobby')
    setNameError('')
  }

  const handleVehicleChoice = (choice: VehicleOption) => {
    //1.- Commit the selected craft so the battle launch uses the expected preset.
    setVehicleId(choice)
  }

  const handleBattle = () => {
    //1.- Validate the pilot name so the HUD has a meaningful identifier.
    if (!playerName.trim()) {
      setNameError('Enter a pilot name before launching into the battle.')
      return
    }
    //2.- Clear any lingering validation messages and push the flow into the active battle stage.
    setNameError('')
    setStage('battle')
  }

  return (
    <main className="gameplay-layout" data-testid="gameplay-page">
      {stage === 'initial' && (
        <section className="gameplay-card" data-testid="join-card">
          <h1>Gameplay Lobby</h1>
          <p>Prep your pilot handle and vehicle to enter the procedurally generated battlefield.</p>
          <button className="primary" data-testid="join-button" onClick={handleJoin} type="button">
            Join Battle
          </button>
        </section>
      )}
      {stage === 'lobby' && (
        <section className="gameplay-card" data-testid="lobby-card">
          <h2>Configure Your Pilot</h2>
          <label className="field">
            <span>Pilot Name</span>
            <input
              aria-label="Pilot name"
              data-testid="pilot-name-field"
              onChange={(event) => setPlayerName(event.target.value)}
              placeholder="Callsign"
              type="text"
              value={playerName}
            />
          </label>
          {nameError && (
            <p className="error" data-testid="name-error">
              {nameError}
            </p>
          )}
          <div className="vehicle-grid" data-testid="vehicle-grid">
            {VEHICLE_IDS.map((vehicle) => (
              <button
                className={vehicle === vehicleId ? 'vehicle selected' : 'vehicle'}
                data-testid={`vehicle-${vehicle}`}
                key={vehicle}
                onClick={() => handleVehicleChoice(vehicle)}
                type="button"
              >
                {vehicle.toUpperCase()}
              </button>
            ))}
          </div>
          <button className="primary" data-testid="launch-button" onClick={handleBattle} type="button">
            To the battle
          </button>
        </section>
      )}
      {stage === 'battle' && (
        <section className="battle-stage" data-testid="battle-stage">
          <div className="battle-stage-content">
            <div className="battle-stage-canvas" data-testid="battle-stage-canvas">
              <BattlefieldCanvas config={battlefield} playerName={playerName} sessionId={sessionId} vehicleId={vehicleId} />
            </div>
            <PlanetaryMapPanel />
          </div>
        </section>
      )}
    </main>
  )
}
