import { describe, expect, it } from 'vitest'

import {
  VehicleFleet,
  blueprintToSnapshot,
  defaultPlanetaryShell,
  enforceSurfaceClearance,
  type VehicleBlueprint
} from './index'

describe('VehicleFleet', () => {
  it('advances each vehicle using its blueprint command', () => {
    const blueprints: VehicleBlueprint[] = [
      {
        id: 'alpha',
        start: { latitudeDeg: 0, longitudeDeg: 0, altitude: defaultPlanetaryShell.surfaceRadius + 50 },
        command: { headingDeg: 45, distance: 300, climb: 10 },
      },
      {
        id: 'beta',
        start: { latitudeDeg: 10, longitudeDeg: 20, altitude: defaultPlanetaryShell.surfaceRadius + 80 },
        command: { headingDeg: 180, distance: 150, climb: -5 },
      },
    ]

    const fleet = new VehicleFleet(defaultPlanetaryShell, blueprints, { surfacePadding: 80_000 })

    //1.- Each call should emit telemetry for every configured blueprint.
    const snapshots = fleet.advance()

    expect(snapshots).toHaveLength(2)
    expect(snapshots.map((snapshot) => snapshot.id)).toEqual(['alpha', 'beta'])
  })

  it('mirrors blueprint starting positions into initial telemetry', () => {
    const blueprint: VehicleBlueprint = {
      id: 'gamma',
      start: enforceSurfaceClearance(
        defaultPlanetaryShell,
        { latitudeDeg: -5, longitudeDeg: 42, altitude: defaultPlanetaryShell.surfaceRadius + 120 },
        80_000,
      ),
      command: { headingDeg: 5, distance: 0, climb: 0 },
    }

    //1.- A snapshot derived from the blueprint should match the clearance-adjusted starting coordinates exactly.
    const snapshot = blueprintToSnapshot(blueprint, defaultPlanetaryShell, { surfacePadding: 80_000 })

    expect(snapshot.position).toEqual(blueprint.start)
    expect(snapshot.laps).toBe(0)
    expect(snapshot.touchingSurface).toBe(false)
    expect(snapshot.hittingCeiling).toBe(false)
  })

  it('enforces the configured clearance even when commands dive into the planet', () => {
    const clearance = 70_000
    const fleet = new VehicleFleet(
      defaultPlanetaryShell,
      [
        {
          id: 'delta',
          start: { latitudeDeg: 8, longitudeDeg: -34, altitude: defaultPlanetaryShell.surfaceRadius + 200 },
          command: { headingDeg: 12, distance: 600, climb: -500 },
        },
      ],
      { surfacePadding: clearance },
    )

    const [snapshot] = fleet.advance()

    //1.- The altitude clamp stops the craft from tunnelling into the planetary mesh while flagging the attempted impact.
    expect(snapshot.position.altitude).toBeGreaterThanOrEqual(defaultPlanetaryShell.surfaceRadius + clearance)
    expect(snapshot.touchingSurface).toBe(true)
  })

  it('iterates zero-clearance spawns until the fleet places craft above the surface', () => {
    const fleet = new VehicleFleet(
      defaultPlanetaryShell,
      [
        {
          id: 'epsilon',
          start: {
            latitudeDeg: 0,
            longitudeDeg: 0,
            altitude: defaultPlanetaryShell.surfaceRadius,
          },
          command: { headingDeg: 0, distance: 0, climb: 0 },
        },
      ],
      { surfacePadding: 0 },
    )

    const [snapshot] = fleet.advance()

    //1.- The sanitiser keeps lifting the spawn altitude until it clears the surface even when padding is disabled.
    expect(snapshot.position.altitude).toBeGreaterThan(defaultPlanetaryShell.surfaceRadius)
    expect(snapshot.touchingSurface).toBe(false)
  })
})
