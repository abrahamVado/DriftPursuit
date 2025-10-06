import { describe, expect, it } from 'vitest'

import { VehicleFleet, blueprintToSnapshot, defaultPlanetaryShell, type VehicleBlueprint } from './index'

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

    const fleet = new VehicleFleet(defaultPlanetaryShell, blueprints)

    //1.- Each call should emit telemetry for every configured blueprint.
    const snapshots = fleet.advance()

    expect(snapshots).toHaveLength(2)
    expect(snapshots.map((snapshot) => snapshot.id)).toEqual(['alpha', 'beta'])
  })

  it('mirrors blueprint starting positions into initial telemetry', () => {
    const blueprint: VehicleBlueprint = {
      id: 'gamma',
      start: { latitudeDeg: -5, longitudeDeg: 42, altitude: defaultPlanetaryShell.surfaceRadius + 120 },
      command: { headingDeg: 5, distance: 0, climb: 0 },
    }

    //1.- A snapshot derived from the blueprint should match the starting coordinates exactly.
    const snapshot = blueprintToSnapshot(blueprint)

    expect(snapshot.position).toEqual(blueprint.start)
    expect(snapshot.laps).toBe(0)
    expect(snapshot.touchingSurface).toBe(false)
    expect(snapshot.hittingCeiling).toBe(false)
  })
})
