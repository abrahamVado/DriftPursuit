import type { PlanetaryShell, SphericalPosition } from './planetConfig';

export interface AtmosphereState {
  altitudeToSurface: number;
  distanceToCeiling: number;
  breathableBandHeight: number;
  outsideBreathableBand: boolean;
}

export const describeAtmosphere = (shell: PlanetaryShell, position: SphericalPosition): AtmosphereState => {
  //1.- Measure how far the traveler is from the surface floor.
  const altitudeToSurface = Math.max(0, position.altitude - shell.surfaceRadius);
  //2.- Measure the remaining clearance until the exosphere hard limit.
  const distanceToCeiling = Math.max(0, shell.exosphereRadius - position.altitude);
  //3.- Establish the size of the breathable layer between surface and atmosphere.
  const breathableBandHeight = shell.atmosphereRadius - shell.surfaceRadius;
  //4.- Flag when the traveler leaves the breathable band but still remains in bounds.
  const outsideBreathableBand = position.altitude > shell.atmosphereRadius || position.altitude < shell.surfaceRadius;

  return {
    altitudeToSurface,
    distanceToCeiling,
    breathableBandHeight,
    outsideBreathableBand
  };
};
