export interface PlanetaryShell {
  readonly surfaceRadius: number;
  readonly atmosphereRadius: number;
  readonly exosphereRadius: number;
}

export const defaultPlanetaryShell: PlanetaryShell = {
  surfaceRadius: 6_000_000,
  atmosphereRadius: 6_050_000,
  exosphereRadius: 6_120_000
};

export interface SphericalPosition {
  latitudeDeg: number;
  longitudeDeg: number;
  altitude: number;
}

export interface MovementCommand {
  headingDeg: number;
  distance: number;
  climb: number;
}

export interface MovementResult {
  position: SphericalPosition;
  laps: number;
  collidedWithSurface: boolean;
  hitAtmosphereCeiling: boolean;
}
