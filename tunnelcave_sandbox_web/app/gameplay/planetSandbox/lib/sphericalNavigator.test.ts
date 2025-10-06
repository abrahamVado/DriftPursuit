import { describe, expect, it } from 'vitest'

import { PlanetTraveler, defaultPlanetaryShell, type MovementCommand, type SphericalPosition } from './index'

describe('PlanetTraveler', () => {
  it('advances along great circles and respects climb limits', () => {
    const start: SphericalPosition = { latitudeDeg: 0, longitudeDeg: 0, altitude: defaultPlanetaryShell.surfaceRadius + 50 }
    const traveler = new PlanetTraveler(defaultPlanetaryShell, start)

    const command: MovementCommand = { headingDeg: 90, distance: 500, climb: 20 }

    //1.- Move eastward and climb slightly to capture updated telemetry.
    const result = traveler.move(command)

    expect(result.position.latitudeDeg).toBeCloseTo(0, 3)
    expect(result.position.longitudeDeg).toBeGreaterThan(0)
    expect(result.position.altitude).toBe(start.altitude + command.climb)
    expect(result.collidedWithSurface).toBe(false)
    expect(result.hitAtmosphereCeiling).toBe(false)
  })

  it('counts laps when crossing the longitudinal seam', () => {
    const start: SphericalPosition = { latitudeDeg: 0, longitudeDeg: 179, altitude: defaultPlanetaryShell.surfaceRadius + 50 }
    const traveler = new PlanetTraveler(defaultPlanetaryShell, start)

    const command: MovementCommand = { headingDeg: 90, distance: 200_000, climb: 0 }

    //1.- Crossing the anti-meridian should increment the lap counter once.
    traveler.move(command)

    expect(traveler.lapsCompleted).toBe(1)
  })

  it('clamps altitude against the surface and exosphere', () => {
    const start: SphericalPosition = { latitudeDeg: 0, longitudeDeg: 0, altitude: defaultPlanetaryShell.surfaceRadius + 5 }
    const traveler = new PlanetTraveler(defaultPlanetaryShell, start)

    //1.- Dive into the surface and then sprint upward beyond the exosphere.
    const descentResult = traveler.move({ headingDeg: 0, distance: 0, climb: -10 })
    const ascentResult = traveler.move({ headingDeg: 0, distance: 0, climb: 1_000_000 })

    expect(descentResult.collidedWithSurface).toBe(true)
    expect(ascentResult.hitAtmosphereCeiling).toBe(true)
  })
})
