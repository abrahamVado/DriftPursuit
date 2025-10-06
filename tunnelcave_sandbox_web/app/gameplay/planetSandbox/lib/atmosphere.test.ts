import { describe, expect, it } from 'vitest'

import { describeAtmosphere, defaultPlanetaryShell, type SphericalPosition } from './index'

describe('describeAtmosphere', () => {
  it('reports breathable band metrics', () => {
    const position: SphericalPosition = {
      latitudeDeg: 12,
      longitudeDeg: 5,
      altitude: defaultPlanetaryShell.surfaceRadius + 100,
    }

    //1.- Sample a position well inside the breathable layer to verify computed distances.
    const snapshot = describeAtmosphere(defaultPlanetaryShell, position)

    expect(snapshot.altitudeToSurface).toBe(100)
    expect(snapshot.breathableBandHeight).toBe(defaultPlanetaryShell.atmosphereRadius - defaultPlanetaryShell.surfaceRadius)
    expect(snapshot.distanceToCeiling).toBe(defaultPlanetaryShell.exosphereRadius - position.altitude)
    expect(snapshot.outsideBreathableBand).toBe(false)
  })

  it('flags when leaving the breathable atmosphere layer', () => {
    const highFlight: SphericalPosition = {
      latitudeDeg: 0,
      longitudeDeg: 0,
      altitude: defaultPlanetaryShell.atmosphereRadius + 10,
    }

    const lowFlight: SphericalPosition = {
      latitudeDeg: 0,
      longitudeDeg: 0,
      altitude: defaultPlanetaryShell.surfaceRadius - 10,
    }

    //1.- Crossing either boundary should mark the traveler as outside the breathable band.
    expect(describeAtmosphere(defaultPlanetaryShell, highFlight).outsideBreathableBand).toBe(true)
    expect(describeAtmosphere(defaultPlanetaryShell, lowFlight).outsideBreathableBand).toBe(true)
  })
})
