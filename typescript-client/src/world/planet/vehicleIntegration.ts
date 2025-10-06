import { PlanetSdf } from "./sdf";
import type { PlanetSpec } from "./planetSpec";

export interface VehicleState {
  //1.- Current position of the vehicle in planet-fixed coordinates.
  position: { x: number; y: number; z: number };
  //2.- Velocity vector expressed in the same reference frame.
  velocity: { x: number; y: number; z: number };
}

export interface VehicleIntegrationOptions {
  //1.- Clearance distance that vehicles must keep above the terrain.
  clearance: number;
  //2.- Maximum integration time step to preserve stability.
  maxDt: number;
}

export class PlanetVehicleIntegrator {
  private readonly sdf: PlanetSdf;
  private readonly options: VehicleIntegrationOptions;

  constructor(spec: PlanetSpec, options: VehicleIntegrationOptions) {
    //1.- Compose the integrator with an SDF evaluator for collision handling.
    this.sdf = new PlanetSdf(spec);
    this.options = options;
  }

  integrate(state: VehicleState, acceleration: { x: number; y: number; z: number }, dt: number): VehicleState {
    //1.- Clamp the time step to avoid overshooting during sub-stepping.
    const step = Math.min(Math.max(dt, 0), this.options.maxDt);
    const velocity = {
      x: state.velocity.x + acceleration.x * step,
      y: state.velocity.y + acceleration.y * step,
      z: state.velocity.z + acceleration.z * step,
    };
    const position = {
      x: state.position.x + velocity.x * step,
      y: state.position.y + velocity.y * step,
      z: state.position.z + velocity.z * step,
    };
    //2.- Query the signed distance to enforce the clearance constraint.
    const sample = this.sdf.sample(position);
    const clearance = sample.distance - this.options.clearance;
    let resolvedPosition = position;
    let resolvedVelocity = velocity;
    if (clearance < 0) {
      const correction = -clearance;
      resolvedPosition = {
        x: position.x + sample.normal.x * correction,
        y: position.y + sample.normal.y * correction,
        z: position.z + sample.normal.z * correction,
      };
      const dot =
        velocity.x * sample.normal.x +
        velocity.y * sample.normal.y +
        velocity.z * sample.normal.z;
      resolvedVelocity = {
        x: velocity.x - sample.normal.x * dot,
        y: velocity.y - sample.normal.y * dot,
        z: velocity.z - sample.normal.z * dot,
      };
    }
    //3.- Clamp against the upper atmosphere boundary.
    const clamped = this.sdf.clampAltitude(resolvedPosition, this.options.clearance);
    const speed = Math.hypot(resolvedVelocity.x, resolvedVelocity.y, resolvedVelocity.z);
    const direction = speed === 0 ? { x: 0, y: 0, z: 0 } : {
      x: resolvedVelocity.x / speed,
      y: resolvedVelocity.y / speed,
      z: resolvedVelocity.z / speed,
    };
    return {
      position: clamped.clamped,
      velocity: { x: direction.x * speed, y: direction.y * speed, z: direction.z * speed },
    };
  }
}
