'use client'

import React from 'react'
import { FormEvent, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DEFAULT_VEHICLE_KEY,
  VEHICLE_KEYS,
  VehicleKey,
  createPilotProfile,
  normalizePilotName,
  normalizeVehicleChoice
} from '@/lib/pilotProfile'

const VEHICLE_LABELS: Record<VehicleKey, string> = {
  arrowhead: 'Arrowhead',
  octahedron: 'Octahedron',
  pyramid: 'Pyramid',
  icosahedron: 'Icosahedron',
  cube: 'Cube',
  transformer: 'Transformer'
}

export default function LobbyPage() {
  const router = useRouter()
  const [pilotName, setPilotName] = useState('')
  const [vehicle, setVehicle] = useState<VehicleKey>(DEFAULT_VEHICLE_KEY)
  const [error, setError] = useState<string | null>(null)

  //1.- Derive the visible vehicle options once so re-renders do not recreate arrays unnecessarily.
  const vehicleOptions = useMemo(() => VEHICLE_KEYS.map((key) => ({ key, label: VEHICLE_LABELS[key] })), [])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    //1.- Sanitise the pilot name and guard against empty submissions.
    const safeName = normalizePilotName(pilotName)
    if (!safeName) {
      setError('Please enter a pilot name before launching.')
      return
    }

    //2.- Clamp the vehicle choice before serialising into the navigation payload.
    const safeVehicle = normalizeVehicleChoice(vehicle)
    const profile = createPilotProfile({ name: safeName, vehicle: safeVehicle })

    const params = new URLSearchParams()
    params.set('pilot', profile.name)
    params.set('vehicle', profile.vehicle)

    setError(null)
    router.push(`/gameplay?${params.toString()}`)
  }

  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: '2rem' }}>
      <form
        onSubmit={handleSubmit}
        style={{
          width: 'min(420px, 100%)',
          display: 'grid',
          gap: '1rem',
          background: 'rgba(10, 13, 18, 0.8)',
          border: '1px solid rgba(134, 206, 255, 0.25)',
          borderRadius: '0.75rem',
          padding: '2rem'
        }}
      >
        <h1 style={{ margin: 0, fontSize: '1.75rem' }}>Flight Deck</h1>
        <p style={{ margin: 0, color: '#a5c9ff' }}>
          //1.- Choose your callsign and preferred chassis before entering the combat simulation.
        </p>

        <label style={{ display: 'grid', gap: '0.5rem' }}>
          <span>Pilot callsign</span>
          <input
            value={pilotName}
            onChange={(event) => setPilotName(event.target.value)}
            placeholder="Rookie Pilot"
            style={{
              padding: '0.75rem',
              borderRadius: '0.5rem',
              border: '1px solid #2a3850',
              background: '#0f1725',
              color: '#e6f1ff'
            }}
          />
        </label>

        <label style={{ display: 'grid', gap: '0.5rem' }}>
          <span>Vehicle</span>
          <select
            value={vehicle}
            onChange={(event) => setVehicle(event.target.value as VehicleKey)}
            style={{
              padding: '0.75rem',
              borderRadius: '0.5rem',
              border: '1px solid #2a3850',
              background: '#0f1725',
              color: '#e6f1ff'
            }}
          >
            {vehicleOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <p role="alert" style={{ color: '#ff9494', margin: 0 }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          style={{
            padding: '0.85rem',
            borderRadius: '0.5rem',
            border: 'none',
            background: '#5aa9ff',
            color: '#08121f',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Enter Hangar
        </button>
      </form>
    </main>
  )
}
