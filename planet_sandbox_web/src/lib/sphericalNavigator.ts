import type {
  MovementCommand,
  MovementResult,
  PlanetaryShell,
  SphericalPosition
} from './planetConfig';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const TWO_PI = Math.PI * 2;

const normalizeLongitude = (valueRad: number): number => {
  //1.- Wrap longitude into the -π to π interval for stable rendering coordinates.
  let wrapped = valueRad % TWO_PI;
  if (wrapped <= -Math.PI) {
    wrapped += TWO_PI;
  }
  if (wrapped > Math.PI) {
    wrapped -= TWO_PI;
  }
  return wrapped;
};

const clamp = (value: number, min: number, max: number): number => {
  //1.- Enforce the provided bounds so altitude never exits the playable shell.
  return Math.min(Math.max(value, min), max);
};

export interface NavigatorOptions {
  surfacePadding?: number;
}

export class PlanetTraveler {
  private current: SphericalPosition;
  private readonly shell: PlanetaryShell;
  private unboundedLongitudeRad: number;
  private completedLaps = 0;
  private readonly surfacePadding: number;

  constructor(shell: PlanetaryShell, initialPosition: SphericalPosition, options: NavigatorOptions = {}) {
    //1.- Persist the configuration so every move uses the same planetary radii.
    this.shell = shell;
    //2.- Accept a tunable hover padding to avoid numerical collision chatter.
    this.surfacePadding = options.surfacePadding ?? 0.5;
    //3.- Elevate the starting state into the safe orbital band so spawning never happens inside the planet.
    const minimumAltitude = this.shell.surfaceRadius + this.surfacePadding;
    const maximumAltitude = this.shell.exosphereRadius;
    this.current = {
      ...initialPosition,
      altitude: clamp(initialPosition.altitude, minimumAltitude, maximumAltitude)
    };
    //4.- Track longitude without wrapping to measure circumnavigation precisely.
    this.unboundedLongitudeRad = initialPosition.longitudeDeg * DEG_TO_RAD;
  }

  get position(): SphericalPosition {
    //1.- Provide an immutable snapshot so UI code cannot mutate internal state.
    return { ...this.current };
  }

  get lapsCompleted(): number {
    //1.- Expose how many equatorial revolutions the traveler has finished.
    return this.completedLaps;
  }

  move(command: MovementCommand): MovementResult {
    //1.- Convert the current latitude and longitude to radians for spherical trig.
    const latitudeRad = this.current.latitudeDeg * DEG_TO_RAD;
    const longitudeRad = this.unboundedLongitudeRad;
    //2.- Translate the command into angular distances along the sphere.
    const angularDistance = command.distance / this.shell.surfaceRadius;
    const headingRad = command.headingDeg * DEG_TO_RAD;

    //3.- Apply the great-circle navigation formula to find the new latitude.
    const sinLat = Math.sin(latitudeRad);
    const cosLat = Math.cos(latitudeRad);
    const sinAngular = Math.sin(angularDistance);
    const cosAngular = Math.cos(angularDistance);
    const sinHeading = Math.sin(headingRad);
    const cosHeading = Math.cos(headingRad);

    const newLatitudeRad = Math.asin(
      sinLat * cosAngular +
        cosLat * sinAngular * cosHeading
    );

    //4.- Derive the longitude delta before any wrapping to keep lap tracking exact.
    const deltaLongitude = Math.atan2(
      sinHeading * sinAngular * cosLat,
      cosAngular - sinLat * Math.sin(newLatitudeRad)
    );
    const newUnboundedLongitude = longitudeRad + deltaLongitude;

    //5.- Detect seam crossings by comparing wrapped intervals before and after.
    const previousSeamIndex = Math.floor((longitudeRad + Math.PI) / TWO_PI);
    const nextSeamIndex = Math.floor((newUnboundedLongitude + Math.PI) / TWO_PI);
    this.completedLaps += nextSeamIndex - previousSeamIndex;

    //6.- Normalise the longitude back into renderable bounds for the public state.
    const newLongitudeRad = normalizeLongitude(newUnboundedLongitude);
    this.unboundedLongitudeRad = newUnboundedLongitude;

    //7.- Integrate the climb command while clamping between the terrain and ceiling.
    const minimumAltitude = this.shell.surfaceRadius + this.surfacePadding;
    const maximumAltitude = this.shell.exosphereRadius;
    const requestedAltitude = this.current.altitude + command.climb;
    const newAltitude = clamp(requestedAltitude, minimumAltitude, maximumAltitude);

    //8.- Flag collisions with the solid surface whenever movement tried to dip below the clearance band.
    const collidedWithSurface = requestedAltitude < minimumAltitude;
    //9.- Flag atmosphere ceiling hits when commands attempt to exceed the outer shell.
    const hitAtmosphereCeiling = requestedAltitude > maximumAltitude;

    //10.- Assemble the updated state in degrees for downstream consumers.
    const updatedPosition: SphericalPosition = {
      latitudeDeg: newLatitudeRad * RAD_TO_DEG,
      longitudeDeg: newLongitudeRad * RAD_TO_DEG,
      altitude: newAltitude
    };

    //11.- Commit the new position for the next integration step.
    this.current = updatedPosition;

    return {
      position: this.position,
      laps: this.completedLaps,
      collidedWithSurface,
      hitAtmosphereCeiling
    };
  }
}
