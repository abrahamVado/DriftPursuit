import { MovementCommand, PlanetaryShell, SphericalPosition } from './planetConfig';
import { PlanetTraveler } from './sphericalNavigator';

export interface VehicleBlueprint {
  readonly id: string;
  readonly start: SphericalPosition;
  readonly command: MovementCommand;
}

export interface VehicleSnapshot {
  readonly id: string;
  readonly position: SphericalPosition;
  readonly laps: number;
  readonly touchingSurface: boolean;
  readonly hittingCeiling: boolean;
}

export class VehicleFleet {
  private readonly travelers: Map<string, PlanetTraveler> = new Map();
  private readonly commands: Map<string, MovementCommand> = new Map();

  constructor(shell: PlanetaryShell, blueprints: VehicleBlueprint[]) {
    for (const blueprint of blueprints) {
      const traveler = new PlanetTraveler(shell, blueprint.start);
      this.travelers.set(blueprint.id, traveler);
      this.commands.set(blueprint.id, blueprint.command);
    }
  }

  advance(): VehicleSnapshot[] {
    const snapshots: VehicleSnapshot[] = [];
    for (const [id, traveler] of this.travelers.entries()) {
      const command = this.commands.get(id);
      if (!command) {
        continue;
      }
      const result = traveler.move(command);
      snapshots.push({
        id,
        position: result.position,
        laps: result.laps,
        touchingSurface: result.collidedWithSurface,
        hittingCeiling: result.hitAtmosphereCeiling
      });
    }
    return snapshots;
  }
}
