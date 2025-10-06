import type { MovementCommand, PlanetaryShell, SphericalPosition } from './planetConfig'
import { PlanetTraveler } from './sphericalNavigator'

export interface VehicleBlueprint {
  readonly id: string
  readonly start: SphericalPosition
  readonly command: MovementCommand
}

export interface VehicleSnapshot {
  readonly id: string
  readonly position: SphericalPosition
  readonly laps: number
  readonly touchingSurface: boolean
  readonly hittingCeiling: boolean
}

export class VehicleFleet {
  private readonly travelers: Map<string, PlanetTraveler> = new Map()
  private readonly commands: Map<string, MovementCommand> = new Map()

  constructor(shell: PlanetaryShell, blueprints: VehicleBlueprint[]) {
    //1.- Spin up a traveler per blueprint so formations can animate independently.
    for (const blueprint of blueprints) {
      const traveler = new PlanetTraveler(shell, blueprint.start)
      this.travelers.set(blueprint.id, traveler)
      this.commands.set(blueprint.id, blueprint.command)
    }
  }

  advance(): VehicleSnapshot[] {
    //1.- Step every traveler with its recorded command and emit the telemetry snapshot.
    const snapshots: VehicleSnapshot[] = []
    for (const [id, traveler] of this.travelers.entries()) {
      const command = this.commands.get(id)
      if (!command) {
        continue
      }
      const result = traveler.move(command)
      snapshots.push({
        id,
        position: result.position,
        laps: result.laps,
        touchingSurface: result.collidedWithSurface,
        hittingCeiling: result.hitAtmosphereCeiling,
      })
    }
    return snapshots
  }
}

export const blueprintToSnapshot = (blueprint: VehicleBlueprint): VehicleSnapshot => {
  //1.- Convert starting blueprints into telemetry entries so UI renders without waiting for the first tick.
  return {
    id: blueprint.id,
    position: { ...blueprint.start },
    laps: 0,
    touchingSurface: false,
    hittingCeiling: false,
  }
}
