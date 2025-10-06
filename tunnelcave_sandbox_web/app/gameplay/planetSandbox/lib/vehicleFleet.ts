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

export interface VehicleFleetOptions {
  surfacePadding?: number
}

const sanitizeAltitude = (shell: PlanetaryShell, altitude: number, surfacePadding: number): number => {
  //1.- Clamp the orbital radius between the surface clearance and the exosphere ceiling for safe rendering.
  const minimum = shell.surfaceRadius + surfacePadding
  const maximum = shell.exosphereRadius
  let sanitized = Math.min(Math.max(altitude, minimum), maximum)
  //2.- Protect zero-clearance callers by iteratively lifting the craft until it sits outside the surface radius.
  if (sanitized <= shell.surfaceRadius) {
    const iterationStep = Math.max(surfacePadding, 1)
    let attempts = 0
    while (sanitized <= shell.surfaceRadius && attempts < 6) {
      sanitized = Math.min(sanitized + iterationStep, maximum)
      attempts += 1
    }
    //3.- Provide a deterministic fallback so floating point noise never leaves the ship embedded underground.
    if (sanitized <= shell.surfaceRadius) {
      sanitized = Math.min(maximum, shell.surfaceRadius + iterationStep)
    }
  }
  return sanitized
}

export class VehicleFleet {
  private readonly travelers: Map<string, PlanetTraveler> = new Map()
  private readonly commands: Map<string, MovementCommand> = new Map()

  constructor(shell: PlanetaryShell, blueprints: VehicleBlueprint[], options: VehicleFleetOptions = {}) {
    const surfacePadding = options.surfacePadding ?? 0.5
    //1.- Spin up a traveler per blueprint so formations can animate independently.
    for (const blueprint of blueprints) {
      const sanitizedStart: SphericalPosition = {
        ...blueprint.start,
        altitude: sanitizeAltitude(shell, blueprint.start.altitude, surfacePadding),
      }
      const traveler = new PlanetTraveler(shell, sanitizedStart, { surfacePadding })
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

export const blueprintToSnapshot = (
  blueprint: VehicleBlueprint,
  shell?: PlanetaryShell,
  options: VehicleFleetOptions = {},
): VehicleSnapshot => {
  const surfacePadding = options.surfacePadding ?? 0.5
  const altitude = shell
    ? sanitizeAltitude(shell, blueprint.start.altitude, surfacePadding)
    : blueprint.start.altitude
  //1.- Convert starting blueprints into telemetry entries so UI renders without waiting for the first tick.
  return {
    id: blueprint.id,
    position: { ...blueprint.start, altitude },
    laps: 0,
    touchingSurface: false,
    hittingCeiling: false,
  }
}

export const enforceSurfaceClearance = (
  shell: PlanetaryShell,
  position: SphericalPosition,
  surfacePadding: number,
): SphericalPosition => {
  //1.- Share the altitude sanitiser so scene setup and fleet logic remain consistent.
  return {
    ...position,
    altitude: sanitizeAltitude(shell, position.altitude, surfacePadding),
  }
}
