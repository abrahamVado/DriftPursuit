import { describe, expect, it } from 'vitest';
import { defaultPlanetaryShell, MovementCommand, SphericalPosition } from '../planetConfig';
import { PlanetTraveler } from '../sphericalNavigator';

const startPosition: SphericalPosition = {
  latitudeDeg: 0,
  longitudeDeg: 0,
  altitude: defaultPlanetaryShell.surfaceRadius + 50
};

const move = (traveler: PlanetTraveler, distance: number, headingDeg = 90): MovementCommand => ({
  distance,
  headingDeg,
  climb: 0
});

describe('PlanetTraveler', () => {
  it('tracks laps when passing the prime meridian repeatedly', () => {
    const traveler = new PlanetTraveler(defaultPlanetaryShell, startPosition);

    //1.- Move eastwards by a full circumference split into quarters to cross seams.
    const circumference = 2 * Math.PI * defaultPlanetaryShell.surfaceRadius;
    const quarter = circumference / 4;

    traveler.move(move(traveler, quarter));
    expect(traveler.lapsCompleted).toBe(0);

    traveler.move(move(traveler, quarter));
    traveler.move(move(traveler, quarter));

    const result = traveler.move(move(traveler, quarter));
    expect(result.laps).toBe(1);
    expect(traveler.lapsCompleted).toBe(1);
  });

  it('clamps the altitude to the atmosphere shell and reports collisions', () => {
    const traveler = new PlanetTraveler(defaultPlanetaryShell, startPosition, { surfacePadding: 0 });

    const descent = traveler.move({ headingDeg: 0, distance: 0, climb: -10_000 });
    expect(descent.position.altitude).toBeCloseTo(defaultPlanetaryShell.surfaceRadius, 4);
    expect(descent.collidedWithSurface).toBe(true);

    const ascent = traveler.move({ headingDeg: 0, distance: 0, climb: 200_000 });
    expect(ascent.position.altitude).toBe(defaultPlanetaryShell.exosphereRadius);
    expect(ascent.hitAtmosphereCeiling).toBe(true);
  });

  it('preserves latitude stability when circling around the equator', () => {
    const traveler = new PlanetTraveler(defaultPlanetaryShell, startPosition);
    const circumference = 2 * Math.PI * defaultPlanetaryShell.surfaceRadius;

    for (let step = 0; step < 20; step += 1) {
      traveler.move(move(traveler, circumference / 20));
    }

    expect(traveler.position.latitudeDeg).toBeCloseTo(0, 3);
  });

  it('applies the surface clearance immediately when starting below the terrain', () => {
    const belowSurface: SphericalPosition = {
      latitudeDeg: 12,
      longitudeDeg: -30,
      altitude: defaultPlanetaryShell.surfaceRadius - 5_000
    };
    const clearance = 1_500;
    const traveler = new PlanetTraveler(defaultPlanetaryShell, belowSurface, { surfacePadding: clearance });

    //1.- The constructor should bump the traveler upwards before any movement occurs.
    expect(traveler.position.altitude).toBe(defaultPlanetaryShell.surfaceRadius + clearance);

    //2.- A stationary integration should keep the traveler outside without reporting a collision.
    const result = traveler.move({ headingDeg: 0, distance: 0, climb: 0 });
    expect(result.position.altitude).toBe(defaultPlanetaryShell.surfaceRadius + clearance);
    expect(result.collidedWithSurface).toBe(false);
  });
});
