import { DeterministicFbm } from "./noise";
import type { PlanetSpec } from "./planetSpec";

export interface SdfSample {
  //1.- Signed distance from the query position to the displaced surface.
  distance: number;
  //2.- Normal vector derived from the gradient for collision responses.
  normal: { x: number; y: number; z: number };
  //3.- Scalar displacement applied to the base radius at this direction.
  displacement: number;
  //4.- Whether the sample lies below the defined sea level plane.
  isOcean: boolean;
}

export class PlanetSdf {
  private readonly spec: PlanetSpec;
  private readonly fbm: DeterministicFbm;

  constructor(spec: PlanetSpec) {
    //1.- Store the specification and initialise the deterministic noise generator.
    this.spec = spec;
    this.fbm = new DeterministicFbm(spec);
  }

  displacementAt(direction: { x: number; y: number; z: number }): number {
    //1.- Evaluate fractal noise on the unit direction to obtain radial offset.
    return this.fbm.sample(direction);
  }

  groundRadius(direction: { x: number; y: number; z: number }): number {
    //1.- Combine base radius with displacement to get the final ground radius.
    return this.spec.radius + this.displacementAt(direction);
  }

  sample(position: { x: number; y: number; z: number }): SdfSample {
    //1.- Compute radial distance and unit vector towards the query point.
    const distanceToCenter = Math.hypot(position.x, position.y, position.z);
    const direction =
      distanceToCenter === 0
        ? { x: 0, y: 1, z: 0 }
        : { x: position.x / distanceToCenter, y: position.y / distanceToCenter, z: position.z / distanceToCenter };
    //2.- Obtain the ground radius and signed distance relative to the surface.
    const displacement = this.displacementAt(direction);
    const surfaceRadius = this.spec.radius + displacement;
    const signedDistance = distanceToCenter - surfaceRadius;
    //3.- Approximate normal via gradient sampling.
    const gradient = this.fbm.gradient(direction);
    const normal = normalise({
      x: direction.x - gradient.x,
      y: direction.y - gradient.y,
      z: direction.z - gradient.z,
    });
    //4.- Determine if the sample is flooded by comparing displacement to sea level.
    const isOcean = surfaceRadius < this.spec.seaLevel;
    return { distance: signedDistance, normal, displacement, isOcean };
  }

  clampAltitude(position: { x: number; y: number; z: number }, clearance: number): {
    clamped: { x: number; y: number; z: number };
    altitude: number;
  } {
    //1.- Ensure the point stays between ground+clearance and the atmosphere shell.
    const distanceToCenter = Math.hypot(position.x, position.y, position.z);
    const direction =
      distanceToCenter === 0
        ? { x: 0, y: 1, z: 0 }
        : { x: position.x / distanceToCenter, y: position.y / distanceToCenter, z: position.z / distanceToCenter };
    const ground = this.groundRadius(direction) + clearance;
    const maxRadius = this.spec.radius + this.spec.atmosphereHeight;
    const clampedRadius = Math.min(Math.max(distanceToCenter, ground), maxRadius);
    return {
      clamped: {
        x: direction.x * clampedRadius,
        y: direction.y * clampedRadius,
        z: direction.z * clampedRadius,
      },
      altitude: clampedRadius - ground,
    };
  }
}

function normalise(vector: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  //1.- Prevent zero-length normals while providing stable fallback direction.
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length === 0) {
    return { x: 0, y: 1, z: 0 };
  }
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}
