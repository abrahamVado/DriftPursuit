import type { PlanetaryShell, SphericalPosition } from './planetConfig'

export interface AtmosphereState {
  altitudeToSurface: number
  distanceToCeiling: number
  breathableBandHeight: number
  outsideBreathableBand: boolean
}

export const describeAtmosphere = (shell: PlanetaryShell, position: SphericalPosition): AtmosphereState => {
  //1.- Measure the vertical clearance from the surface so the HUD can show impact risk.
  const altitudeToSurface = Math.max(0, position.altitude - shell.surfaceRadius)
  //2.- Compute the remaining headroom until the exosphere to gauge ceiling collisions.
  const distanceToCeiling = Math.max(0, shell.exosphereRadius - position.altitude)
  //3.- Track the habitable band depth to highlight breathable range within the UI copy.
  const breathableBandHeight = shell.atmosphereRadius - shell.surfaceRadius
  //4.- Flag when the craft leaves the breathable band even if it remains within shell bounds.
  const outsideBreathableBand = position.altitude > shell.atmosphereRadius || position.altitude < shell.surfaceRadius

  return {
    altitudeToSurface,
    distanceToCeiling,
    breathableBandHeight,
    outsideBreathableBand,
  }
}
