import type { PlanetSpec } from "./planetSpec";
import { PlanetSdf } from "./sdf";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TangentBasis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

export interface FlightState {
  position: Vec3;
  velocity: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

export interface FlightInput {
  throttle: number;
  pitch: number;
  yaw: number;
  roll: number;
  autopilotSouth?: boolean;
}

export interface PlanetFlightConfig {
  clearance: number;
  maxSpeed: number;
  thrustAcceleration: number;
  yawRate: number;
  pitchRate: number;
  rollRate: number;
  dragCoefficient: number;
  lateralDamping: number;
  impactDamping: number;
  surfaceFriction: number;
}

const DEFAULT_CONFIG: PlanetFlightConfig = {
  clearance: 5,
  maxSpeed: 250,
  thrustAcceleration: 30,
  yawRate: (45 * Math.PI) / 180,
  pitchRate: (30 * Math.PI) / 180,
  rollRate: (60 * Math.PI) / 180,
  dragCoefficient: 0.015,
  lateralDamping: 2,
  impactDamping: 0.5,
  surfaceFriction: 0.2,
};

export function computeLocalTangentBasis(position: Vec3): TangentBasis {
  //1.- Determine the up vector by normalising the planet-space position.
  const up = normalise(position);
  //2.- Project a stable reference axis onto the tangent plane to obtain local north.
  const reference: Vec3 = Math.abs(up.y) > 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  let forward = projectOntoPlane(reference, up);
  if (length(forward) === 0) {
    forward = projectOntoPlane({ x: 0, y: 0, z: 1 }, up);
  }
  forward = normalise(forward);
  //3.- Compute a right-handed basis that aligns with the east direction on the tangent plane.
  let right = cross(up, forward);
  right = normalise(right);
  forward = normalise(cross(right, up));
  return { forward, right, up };
}

export class PlanetFlightModel {
  private readonly spec: PlanetSpec;
  private readonly config: PlanetFlightConfig;
  private readonly sdf: PlanetSdf;

  constructor(spec: PlanetSpec, config: Partial<PlanetFlightConfig> = {}) {
    //1.- Merge the provided tuning parameters with sensible defaults for stability.
    this.config = { ...DEFAULT_CONFIG, ...config } satisfies PlanetFlightConfig;
    //2.- Cache the specification and a terrain SDF evaluator for collision handling.
    this.spec = spec;
    this.sdf = new PlanetSdf(spec);
  }

  step(previous: FlightState, input: FlightInput, dt: number): FlightState {
    //1.- Reject degenerate timesteps so determinism matches between clients.
    if (!(dt > 0)) {
      return { ...previous, position: { ...previous.position }, velocity: { ...previous.velocity } };
    }
    const clampedInput = clampInput(input);
    const radialUp = normalise(previous.position);
    const tangentBasis = computeLocalTangentBasis(previous.position);
    let forward = normalise(projectOntoPlane(previous.forward ?? tangentBasis.forward, radialUp));
    if (length(forward) === 0) {
      forward = tangentBasis.forward;
    }
    let right = normalise(cross(radialUp, forward));
    if (length(right) === 0) {
      right = tangentBasis.right;
    }
    let up = radialUp;
    if (clampedInput.autopilotSouth) {
      //2.- Autopilot aligns the craft with the local south great-circle direction.
      forward = negate(tangentBasis.forward);
      right = normalise(cross(up, forward));
      up = normalise(cross(forward, right));
    } else {
      //3.- Apply manual rotations around the local axes to track the player's inputs.
      forward = rotateAroundAxis(forward, up, clampedInput.yaw * this.config.yawRate * dt);
      forward = rotateAroundAxis(forward, right, clampedInput.pitch * this.config.pitchRate * dt);
      forward = normalise(projectOntoPlane(forward, up));
      right = normalise(cross(up, forward));
      let rollAxis = forward;
      if (length(rollAxis) === 0) {
        rollAxis = tangentBasis.forward;
      }
      right = rotateAroundAxis(right, rollAxis, clampedInput.roll * this.config.rollRate * dt);
      right = normalise(projectOntoPlane(right, up));
      up = normalise(cross(forward, right));
    }
    //4.- Begin with the previous velocity to accumulate forces in planet space.
    let velocity = { ...previous.velocity };
    const sample = this.sdf.sample(previous.position);
    const targetSpeed = clampedInput.throttle * this.config.maxSpeed;
    const currentForwardSpeed = dot(velocity, forward);
    const maxDelta = this.config.thrustAcceleration * dt;
    const deltaSpeed = clamp(targetSpeed - currentForwardSpeed, -maxDelta, maxDelta);
    velocity.x += forward.x * deltaSpeed;
    velocity.y += forward.y * deltaSpeed;
    velocity.z += forward.z * deltaSpeed;
    const newForwardSpeed = dot(velocity, forward);
    const lateral = {
      x: velocity.x - forward.x * newForwardSpeed,
      y: velocity.y - forward.y * newForwardSpeed,
      z: velocity.z - forward.z * newForwardSpeed,
    } satisfies Vec3;
    velocity.x -= lateral.x * this.config.lateralDamping * dt;
    velocity.y -= lateral.y * this.config.lateralDamping * dt;
    velocity.z -= lateral.z * this.config.lateralDamping * dt;
    const speed = length(velocity);
    if (speed > 0) {
      //5.- Model atmospheric drag with a linear density falloff from sea level to the ceiling.
      const density = airDensity(sample.distance, this.spec.atmosphereHeight);
      const dragAccel = this.config.dragCoefficient * density * speed * speed;
      const dragDelta = Math.min(dragAccel * dt, speed);
      const dragDir = scale(velocity, -1 / speed);
      velocity.x += dragDir.x * dragDelta;
      velocity.y += dragDir.y * dragDelta;
      velocity.z += dragDir.z * dragDelta;
    }
    const nextPosition = {
      x: previous.position.x + velocity.x * dt,
      y: previous.position.y + velocity.y * dt,
      z: previous.position.z + velocity.z * dt,
    } satisfies Vec3;
    const clampResult = this.sdf.clampAltitude(nextPosition, this.config.clearance);
    let finalPosition = clampResult.clamped;
    let finalVelocity = { ...velocity };
    const maxRadius = this.spec.radius + this.spec.atmosphereHeight;
    const nextRadius = length(nextPosition);
    if (nextRadius >= maxRadius - 1e-3) {
      //6.- Remove outward velocity when the craft reaches the atmosphere ceiling.
      const ceilingNormal = normalise(finalPosition);
      const outward = dot(finalVelocity, ceilingNormal);
      if (outward > 0) {
        finalVelocity = subtract(finalVelocity, scale(ceilingNormal, outward));
      }
    }
    if (clampResult.altitude <= 1e-3) {
      //7.- Resolve ground contact by pushing along the normal and damping impact velocity.
      const ground = this.sdf.sample(finalPosition);
      finalPosition = {
        x: finalPosition.x + ground.normal.x * (this.config.clearance - ground.distance),
        y: finalPosition.y + ground.normal.y * (this.config.clearance - ground.distance),
        z: finalPosition.z + ground.normal.z * (this.config.clearance - ground.distance),
      } satisfies Vec3;
      const normalVelocity = dot(finalVelocity, ground.normal);
      if (normalVelocity < 0) {
        finalVelocity = subtract(finalVelocity, scale(ground.normal, normalVelocity * (1 + this.config.impactDamping)));
      }
      finalVelocity.x *= 1 - this.config.surfaceFriction;
      finalVelocity.y *= 1 - this.config.surfaceFriction;
      finalVelocity.z *= 1 - this.config.surfaceFriction;
    }
    const correctedUp = normalise(finalPosition);
    let correctedForward = normalise(projectOntoPlane(forward, correctedUp));
    if (length(correctedForward) === 0) {
      correctedForward = tangentBasis.forward;
    }
    const correctedRight = normalise(cross(correctedUp, correctedForward));
    const correctedBasis: TangentBasis = {
      forward: correctedForward,
      right: correctedRight,
      up: normalise(cross(correctedForward, correctedRight)),
    };
    return {
      position: finalPosition,
      velocity: finalVelocity,
      forward: correctedBasis.forward,
      right: correctedBasis.right,
      up: correctedBasis.up,
    } satisfies FlightState;
  }
}

function clampInput(input: FlightInput): FlightInput {
  //1.- Constrain control inputs so they stay within meaningful physical ranges.
  return {
    throttle: clamp(input.throttle, 0, 1),
    pitch: clamp(input.pitch, -1, 1),
    yaw: clamp(input.yaw, -1, 1),
    roll: clamp(input.roll, -1, 1),
    autopilotSouth: Boolean(input.autopilotSouth),
  } satisfies FlightInput;
}

function clamp(value: number, minValue: number, maxValue: number): number {
  //1.- Provide a reusable numeric clamp utility to keep logic concise.
  return Math.min(Math.max(value, minValue), maxValue);
}

function length(vector: Vec3): number {
  //1.- Return the Euclidean norm of the 3D vector.
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalise(vector: Vec3): Vec3 {
  //1.- Avoid dividing by zero by falling back to a safe axis when the magnitude vanishes.
  const len = length(vector);
  if (len === 0) {
    return { x: 0, y: 1, z: 0 };
  }
  return { x: vector.x / len, y: vector.y / len, z: vector.z / len } satisfies Vec3;
}

function dot(a: Vec3, b: Vec3): number {
  //1.- Compute the scalar product between two vectors.
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  //1.- Build the perpendicular vector following the right-hand rule.
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  } satisfies Vec3;
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  //1.- Helper used when removing projected velocity components.
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z } satisfies Vec3;
}

function scale(vector: Vec3, scalar: number): Vec3 {
  //1.- Scale a vector uniformly to express accelerations and impulses.
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar } satisfies Vec3;
}

function projectOntoPlane(vector: Vec3, normal: Vec3): Vec3 {
  //1.- Remove the component parallel to the normal so the vector lies on the tangent plane.
  const n = normalise(normal);
  const projection = dot(vector, n);
  return subtract(vector, scale(n, projection));
}

function rotateAroundAxis(vector: Vec3, axis: Vec3, angle: number): Vec3 {
  //1.- Apply Rodrigues' rotation formula for stable incremental control inputs.
  if (Math.abs(angle) < 1e-6) {
    return { ...vector } satisfies Vec3;
  }
  const unitAxis = normalise(axis);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dotVA = dot(vector, unitAxis);
  const crossVA = cross(unitAxis, vector);
  return {
    x: vector.x * cos + crossVA.x * sin + unitAxis.x * dotVA * (1 - cos),
    y: vector.y * cos + crossVA.y * sin + unitAxis.y * dotVA * (1 - cos),
    z: vector.z * cos + crossVA.z * sin + unitAxis.z * dotVA * (1 - cos),
  } satisfies Vec3;
}

function negate(vector: Vec3): Vec3 {
  //1.- Reuse basis vectors with flipped direction when steering southbound.
  return { x: -vector.x, y: -vector.y, z: -vector.z } satisfies Vec3;
}

function airDensity(altitude: number, atmosphereHeight: number): number {
  //1.- Clamp altitude to a valid range before applying the linear falloff curve.
  if (!(atmosphereHeight > 0)) {
    return 0;
  }
  const normalised = clamp(altitude / atmosphereHeight, 0, 1);
  return 1 - normalised;
}

