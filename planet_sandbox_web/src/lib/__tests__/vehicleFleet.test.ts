import { describe, expect, it } from 'vitest';
import { defaultPlanetaryShell, MovementCommand, SphericalPosition } from '../planetConfig';
import {
  VehicleFleet,
  VehicleSnapshot,
  VehicleFleetOptions,
  blueprintToSnapshot
} from '../vehicleFleet';

const createFleet = (
  commands: Array<{ id: string; start: SphericalPosition; command: MovementCommand }>,
  options: VehicleFleetOptions = {}
) => {
  return new VehicleFleet(
    defaultPlanetaryShell,
    commands.map(({ id, start, command }) => ({ id, start, command })),
    options
  );
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

  it('applies orbital clearance when a minimum surface padding is requested', () => {
    const clearance = 80_000;
    const fleet = createFleet(
      [
        {
          id: 'hopper',
          start: { latitudeDeg: 12, longitudeDeg: -18, altitude: defaultPlanetaryShell.surfaceRadius + 100 },
          command: { headingDeg: 40, distance: 500, climb: -400 }
        }
      ],
      { surfacePadding: clearance }
    );

    const [snapshot] = fleet.advance();

    //1.- The enforced clearance keeps the escort outside the planet surface while still reporting the attempted impact.
    expect(snapshot.position.altitude).toBeGreaterThanOrEqual(defaultPlanetaryShell.surfaceRadius + clearance);
    expect(snapshot.touchingSurface).toBe(true);
  });

  it('iteratively raises zero-clearance spawns until they sit outside the planet', () => {
    const fleet = createFleet([
      {
        id: 'riser',
        start: {
          latitudeDeg: 0,
          longitudeDeg: 0,
          altitude: defaultPlanetaryShell.surfaceRadius
        },
        command: { headingDeg: 0, distance: 0, climb: 0 }
      }
    ], {
      surfacePadding: 0
    });

    const [snapshot] = fleet.advance();

    //1.- The spawn logic now iterates until the craft clears the planetary surface even with zero padding configured.
    expect(snapshot.position.altitude).toBeGreaterThan(defaultPlanetaryShell.surfaceRadius);
    expect(snapshot.touchingSurface).toBe(false);
  });

  it('raises snapshot altitudes to respect the same clearance heuristic', () => {
    const clearance = 60_000;
    const blueprint = {
      id: 'sentinel',
      start: { latitudeDeg: -8, longitudeDeg: 72, altitude: defaultPlanetaryShell.surfaceRadius + 500 },
      command: { headingDeg: 0, distance: 0, climb: 0 }
    };

    const snapshot = blueprintToSnapshot(blueprint, defaultPlanetaryShell, { surfacePadding: clearance });

    //1.- Even before simulation ticks, the telemetry mirrors the lifted orbital altitude.
    expect(snapshot.position.altitude).toBe(defaultPlanetaryShell.surfaceRadius + clearance);
    expect(snapshot.touchingSurface).toBe(false);
    expect(snapshot.hittingCeiling).toBe(false);
  });
});
