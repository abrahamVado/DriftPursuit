import { describe, expect, it } from 'vitest';
import { defaultPlanetaryShell, MovementCommand, SphericalPosition } from '../planetConfig';
import { VehicleFleet, VehicleSnapshot } from '../vehicleFleet';

const createFleet = (commands: Array<{ id: string; start: SphericalPosition; command: MovementCommand }>) => {
  return new VehicleFleet(defaultPlanetaryShell, commands.map(({ id, start, command }) => ({ id, start, command })));
};

describe('VehicleFleet', () => {
  it('advances every registered vehicle and keeps laps in sync', () => {
    const fleet = createFleet([
      {
        id: 'scout',
        start: { latitudeDeg: 0, longitudeDeg: 0, altitude: defaultPlanetaryShell.surfaceRadius + 500 },
        command: { headingDeg: 120, distance: 1_200, climb: 1 }
      },
      {
        id: 'freighter',
        start: { latitudeDeg: 10, longitudeDeg: 200, altitude: defaultPlanetaryShell.surfaceRadius + 200 },
        command: { headingDeg: 70, distance: 900, climb: -2 }
      }
    ]);

    const firstAdvance = fleet.advance();
    const secondAdvance = fleet.advance();

    const distances = secondAdvance.map((snapshot: VehicleSnapshot) => snapshot.position.longitudeDeg);
    expect(firstAdvance).toHaveLength(2);
    expect(secondAdvance).toHaveLength(2);
    expect(distances[0]).not.toBe(distances[1]);
  });

  it('reports when vehicles strike the atmosphere or surface', () => {
    const fleet = createFleet([
      {
        id: 'glider',
        start: { latitudeDeg: 0, longitudeDeg: 0, altitude: defaultPlanetaryShell.surfaceRadius + 10 },
        command: { headingDeg: 0, distance: 10, climb: -50 }
      },
      {
        id: 'orbiter',
        start: { latitudeDeg: 0, longitudeDeg: 180, altitude: defaultPlanetaryShell.exosphereRadius - 5 },
        command: { headingDeg: 0, distance: 10, climb: 200 }
      }
    ]);

    const [glider, orbiter] = fleet.advance();

    expect(glider.touchingSurface).toBe(true);
    expect(orbiter.hittingCeiling).toBe(true);
  });
});
