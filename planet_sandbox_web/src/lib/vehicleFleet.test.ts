import { describe, expect, it } from 'vitest';
import { blueprintToSnapshot, VehicleBlueprint } from './vehicleFleet';

describe('blueprintToSnapshot', () => {
  it('converts a vehicle blueprint into a neutral telemetry snapshot', () => {
    const blueprint: VehicleBlueprint = {
      id: 'observer',
      start: { latitudeDeg: 12.5, longitudeDeg: -42.75, altitude: 1_500 },
      command: { headingDeg: 90, distance: 1_000, climb: 10 }
    };

    const snapshot = blueprintToSnapshot(blueprint);

    expect(snapshot).toEqual({
      id: 'observer',
      position: { latitudeDeg: 12.5, longitudeDeg: -42.75, altitude: 1_500 },
      laps: 0,
      touchingSurface: false,
      hittingCeiling: false
    });
  });

  it('returns a defensive copy of the vehicle position', () => {
    const blueprint: VehicleBlueprint = {
      id: 'spectator',
      start: { latitudeDeg: 0, longitudeDeg: 0, altitude: 1_200 },
      command: { headingDeg: 45, distance: 2_000, climb: 5 }
    };

    const snapshot = blueprintToSnapshot(blueprint);
    snapshot.position.latitudeDeg = 90;

    expect(blueprint.start.latitudeDeg).toBe(0);
  });
});
