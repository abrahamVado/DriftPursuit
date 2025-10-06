import type { MovementCommand, MovementResult, PlanetaryShell, SphericalPosition } from './planetConfig'

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI
const TWO_PI = Math.PI * 2

const normalizeLongitude = (valueRad: number): number => {
  //1.- Wrap longitudes into [-π, π] so render coordinates remain numerically stable.
  let wrapped = valueRad % TWO_PI
  if (wrapped <= -Math.PI) {
    wrapped += TWO_PI
  }
  if (wrapped > Math.PI) {
    wrapped -= TWO_PI
  }
  return wrapped
}

const clamp = (value: number, min: number, max: number): number => {
  //1.- Restrict values within the supplied interval to avoid escaping the shell bounds.
  return Math.min(Math.max(value, min), max)
}

export interface NavigatorOptions {
  surfacePadding?: number
}

export class PlanetTraveler {
  private current: SphericalPosition
  private readonly shell: PlanetaryShell
  private unboundedLongitudeRad: number
  private completedLaps = 0
  private readonly surfacePadding: number

  constructor(shell: PlanetaryShell, initialPosition: SphericalPosition, options: NavigatorOptions = {}) {
    //1.- Cache the planetary shell radii so each move uses consistent bounds.
    this.shell = shell
    //2.- Clone the starting position to preserve immutability of external callers.
    this.current = { ...initialPosition }
    //3.- Track longitude without wrapping to count circumnavigation laps precisely.
    this.unboundedLongitudeRad = initialPosition.longitudeDeg * DEG_TO_RAD
    //4.- Permit a tweakable buffer above the surface to reduce collision chatter.
    this.surfacePadding = options.surfacePadding ?? 0.5
  }

  get position(): SphericalPosition {
    //1.- Return a defensive copy so UI code cannot mutate the internal navigator state.
    return { ...this.current }
  }

  get lapsCompleted(): number {
    //1.- Expose the total laps for HUD displays while keeping the field read-only.
    return this.completedLaps
  }

  move(command: MovementCommand): MovementResult {
    //1.- Convert current coordinates into radians so spherical trig is straightforward.
    const latitudeRad = this.current.latitudeDeg * DEG_TO_RAD
    const longitudeRad = this.unboundedLongitudeRad
    //2.- Translate the movement into angular displacements on the sphere surface.
    const angularDistance = command.distance / this.shell.surfaceRadius
    const headingRad = command.headingDeg * DEG_TO_RAD

    //3.- Resolve the new latitude using the great-circle navigation formula.
    const sinLat = Math.sin(latitudeRad)
    const cosLat = Math.cos(latitudeRad)
    const sinAngular = Math.sin(angularDistance)
    const cosAngular = Math.cos(angularDistance)
    const sinHeading = Math.sin(headingRad)
    const cosHeading = Math.cos(headingRad)

    const newLatitudeRad = Math.asin(
      sinLat * cosAngular +
        cosLat * sinAngular * cosHeading,
    )

    //4.- Compute the longitude change prior to wrapping to keep lap tracking continuous.
    const deltaLongitude = Math.atan2(
      sinHeading * sinAngular * cosLat,
      cosAngular - sinLat * Math.sin(newLatitudeRad),
    )
    const newUnboundedLongitude = longitudeRad + deltaLongitude

    //5.- Count seam crossings by comparing unbounded longitude intervals before and after.
    const previousSeamIndex = Math.floor((longitudeRad + Math.PI) / TWO_PI)
    const nextSeamIndex = Math.floor((newUnboundedLongitude + Math.PI) / TWO_PI)
    this.completedLaps += nextSeamIndex - previousSeamIndex

    //6.- Wrap longitude back into renderable bounds for the public snapshot.
    const newLongitudeRad = normalizeLongitude(newUnboundedLongitude)
    this.unboundedLongitudeRad = newUnboundedLongitude

    //7.- Apply climb input while clamping between surface padding and exosphere ceiling.
    const newAltitude = clamp(
      this.current.altitude + command.climb,
      this.shell.surfaceRadius + this.surfacePadding,
      this.shell.exosphereRadius,
    )

    //8.- Detect contact with the terrain whenever the altitude clamp hits the lower bound.
    const collidedWithSurface = newAltitude <= this.shell.surfaceRadius + this.surfacePadding + Number.EPSILON
    //9.- Detect ceiling saturation whenever altitude touches the exosphere radius.
    const hitAtmosphereCeiling = newAltitude >= this.shell.exosphereRadius - Number.EPSILON

    //10.- Convert the computed radians back into degrees for UI friendly telemetry.
    const updatedPosition: SphericalPosition = {
      latitudeDeg: newLatitudeRad * RAD_TO_DEG,
      longitudeDeg: newLongitudeRad * RAD_TO_DEG,
      altitude: newAltitude,
    }

    //11.- Persist the result for the following integration step.
    this.current = updatedPosition

    return {
      position: this.position,
      laps: this.completedLaps,
      collidedWithSurface,
      hitAtmosphereCeiling,
    }
  }
}
