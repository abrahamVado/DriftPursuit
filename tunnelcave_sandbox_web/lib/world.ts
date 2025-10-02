import type { SandboxParams } from "./config";
import { createChunkBand, ensureChunks, type ChunkBand } from "./streaming";
import { chooseSpawn, type SpawnPose } from "./probe";
import type { RingStation } from "./terrain";
import { createCameraRig, type CameraParams, type CameraRig, updateCameraRig } from "./camera";
import {
  add,
  cross,
  dot,
  length,
  normalize,
  rotateAroundAxis,
  scale,
  sub,
  Vec3,
  lerp
} from "./vector";

export interface SimulationParams {
  sandbox: SandboxParams;
  camera: CameraParams;
  craftRadius: number;
}

export interface CraftState {
  speed: number;
  targetSpeed: number;
  position: Vec3;
  velocity: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  angularVelocity: Vec3;
  crashed: boolean;
}

export interface SimulationState {
  band: ChunkBand & {
    // Centerline API we attach at runtime (meters-based):
    centerAt?: (sMeters: number) => Vec3;
    tangentAt?: (sMeters: number) => Vec3;
    closestS?: (p: Vec3 | { x: number; y: number; z: number }) => number;
    length?: number; // getter (meters) over currently loaded rings
    sample?: (sMeters: number) => { position: Vec3; tangent: Vec3; right: Vec3; up: Vec3 };
  };
  camera: CameraRig;
  craft: CraftState;
  spawn: SpawnPose;
}

export interface PlayerInput {
  throttleDelta: number;
  rollDelta: number;
  pitchDelta: number;
  yawDelta: number;
}

function collectRings(band: ChunkBand): RingStation[] {
  const rings: RingStation[] = [];
  for (const chunk of band.chunks.values()) {
    rings.push(...chunk.rings);
  }
  rings.sort((a, b) => a.index - b.index);
  return rings;
}

function interpolateRing(rings: RingStation[], arc: number): {
  position: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
} {
  const ringIndex = Math.floor(arc);
  const nextIndex = Math.min(rings[rings.length - 1].index, ringIndex + 1);
  const base = rings.find((r) => r.index === ringIndex) ?? rings[0];
  const next = rings.find((r) => r.index === nextIndex) ?? base;
  const t = Math.min(1, Math.max(0, arc - ringIndex));
  const position: Vec3 = lerp(base.position, next.position, t);
  const forward = normalize(lerp(base.frame.forward, next.frame.forward, t));
  let right = lerp(base.frame.right, next.frame.right, t);
  right = normalize(right);
  let up = cross(forward, right);
  const upLen = length(up);
  if (upLen === 0) {
    up = base.frame.up;
  } else {
    up = scale(up, 1 / upLen);
  }
  right = cross(up, forward);
  return { position, forward, right, up };
}

/* ------------------------ Centerline helpers (meters <-> arc) ------------------------ */

/** Convert {x,y,z} or Vec3-like into Vec3 tuple */
function toVec3(p: Vec3 | { x: number; y: number; z: number }): Vec3 {
  if (Array.isArray(p)) return p as Vec3;
  return [p.x, p.y, p.z];
}

/** Map meters -> arc units using ringStep (meters between ring indices) */
function metersToArc(sMeters: number, ringStep: number): number {
  return sMeters / ringStep;
}

/** Map arc units -> meters using ringStep */
function arcToMeters(arc: number, ringStep: number): number {
  return arc * ringStep;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const MASS = 1;
const GRAVITY: Vec3 = [0, -9.81 * MASS, 0];
const MIN_SPEED = 2;
const MAX_SPEED = 80;
const BASE_THRUST = 12;
const THRUST_GAIN = 6;
const LIFT_COEF = 0.12;
const DRAG_COEF = 0.05;
const RADIAL_SPRING = 8;
const RADIAL_DAMPING = 4;
const CONTROL_DAMPING = 0.35;
const ROLL_CONTROL = 3.5;
const PITCH_CONTROL = 2.5;
const YAW_CONTROL = 2.8;
const ALIGNMENT_GAIN = 1.2;
const RESTITUTION = 0.25;

function orthonormalize(forward: Vec3, up: Vec3): { forward: Vec3; right: Vec3; up: Vec3 } {
  const f = normalize(forward);
  let r = cross(f, up);
  let rLen = length(r);
  if (rLen < 1e-5) {
    const fallback: Vec3 = Math.abs(f[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
    r = cross(f, fallback);
    rLen = length(r);
  }
  const invR = rLen > 0 ? 1 / rLen : 0;
  r = scale(r, invR);
  const u = normalize(cross(r, f));
  return { forward: f, right: r, up: u };
}

function resolveTerrainCollision(
  craft: CraftState,
  rings: RingStation[],
  craftRadius: number,
  arc: number,
  ringStep: number
) {
  if (rings.length === 0) return;

  const approxIndex = Math.floor(arc);
  let bestPenetration = 0;
  let bestRing: RingStation | null = null;
  let bestNormal: Vec3 | null = null;
  let bestAlong = 0;
  let bestClearance = 0;

  for (const ring of rings) {
    if (Math.abs(ring.index - approxIndex) > 6) continue;
    const toCraft = sub(craft.position, ring.position);
    const along = dot(toCraft, ring.frame.forward);
    if (Math.abs(along) > ringStep * 3) continue;
    const axial = scale(ring.frame.forward, along);
    let radial = sub(toCraft, axial);
    const radialLen = length(radial);
    const rightComp = dot(radial, ring.frame.right);
    const upComp = dot(radial, ring.frame.up);
    const theta = Math.atan2(upComp, rightComp);
    const surfaceRadius = ring.radius + ring.roughness(theta);
    const clearance = surfaceRadius + craftRadius;
    const penetration = clearance - radialLen;
    if (penetration > bestPenetration) {
      let normal: Vec3;
      if (radialLen > 1e-4) {
        normal = scale(radial, 1 / radialLen);
      } else {
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        normal = normalize(
          add(scale(ring.frame.right, cosT), scale(ring.frame.up, sinT))
        );
      }
      bestPenetration = penetration;
      bestRing = ring;
      bestNormal = normal;
      bestAlong = along;
      bestClearance = clearance;
    }
  }

  if (!bestRing || !bestNormal || bestPenetration <= 0) return;

  const alongOffset = scale(bestRing.frame.forward, bestAlong);
  const surfacePoint = add(
    bestRing.position,
    add(alongOffset, scale(bestNormal, bestClearance))
  );
  craft.position = surfacePoint;

  const vn = dot(craft.velocity, bestNormal);
  if (vn < 0) {
    craft.velocity = sub(craft.velocity, scale(bestNormal, (1 + RESTITUTION) * vn));
  }

  craft.speed = length(craft.velocity);

  if (bestPenetration > craftRadius * 0.6) {
    craft.crashed = true;
    craft.velocity = [0, 0, 0] as Vec3;
    craft.speed = 0;
    craft.targetSpeed = 0;
    craft.angularVelocity = [0, 0, 0] as Vec3;
  }
}

/* ----------------------------------- Simulation ----------------------------------- */

export function createSimulation(params: SimulationParams): SimulationState {
  const band = createChunkBand(params.sandbox);
  ensureChunks(band, 0);
  const rings = collectRings(band);
  const spawn = chooseSpawn(rings, params.craftRadius);
  if (!spawn) {
    throw new Error("Failed to find spawn ring");
  }

  /* --- Centerline API on band (EXPOSED) -------------------------------------------
     We attach methods that the missiles use. They are meters-based so other systems
     can treat them as true arc-length. Internally we just convert to your 'arc'
     (ring index space) and reuse interpolateRing().
  ------------------------------------------------------------------------------- */
  // Recompute a fresh rings array whenever we sample; chunks are streaming.
  function currentRings(): RingStation[] {
    return collectRings(band);
  }

  const ringStep = params.sandbox.ringStep; // meters per ring index step

  // Point at arc-length s (meters)
  (band as any).centerAt = (sMeters: number): Vec3 => {
    const r = currentRings();
    if (r.length === 0) return [0, 0, 0];
    const arc = metersToArc(sMeters, ringStep);
    const sample = interpolateRing(r, arc);
    return sample.position;
  };

  // Unit tangent at arc-length s (meters)
  (band as any).tangentAt = (sMeters: number): Vec3 => {
    const r = currentRings();
    if (r.length === 0) return [0, 0, 1];
    const arc = metersToArc(sMeters, ringStep);
    const sample = interpolateRing(r, arc);
    return sample.forward; // already unit-length
  };

  // Convenience sampler
  (band as any).sample = (sMeters: number) => {
    const r = currentRings();
    const arc = metersToArc(sMeters, ringStep);
    const s = interpolateRing(r, arc);
    return { position: s.position, tangent: s.forward, right: s.right, up: s.up };
  };

  // Closest arc-length (meters) to world point p
  (band as any).closestS = (p: Vec3 | { x: number; y: number; z: number }): number => {
    const r = currentRings();
    if (r.length === 0) return 0;
    const P = toVec3(p);

    // Coarse search over ring stations (cheap at spawn time)
    let bestIdx = 0;
    let bestD2 = Infinity;
    for (let i = 0; i < r.length; i++) {
      const q = r[i].position;
      const dx = q[0] - P[0], dy = q[1] - P[1], dz = q[2] - P[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; bestIdx = i; }
    }

    // Optional small local refine between bestIdx and its neighbor to get sub-ring precision
    const i0 = Math.max(0, bestIdx - 1);
    const i1 = Math.min(r.length - 1, bestIdx + 1);
    let bestArc = r[bestIdx].index;
    bestD2 = Infinity;

    const REFINE_STEPS = 12;
    for (let i = i0; i < i1; i++) {
      const idxA = r[i].index;
      const idxB = r[i + 1].index;
      for (let k = 0; k <= REFINE_STEPS; k++) {
        const t = k / REFINE_STEPS;
        const arc = idxA + (idxB - idxA) * t;
        const s = interpolateRing(r, arc);
        const q = s.position;
        const dx = q[0] - P[0], dy = q[1] - P[1], dz = q[2] - P[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; bestArc = arc; }
      }
    }

    return arcToMeters(bestArc, ringStep);
  };

  // Expose a dynamic 'length' in meters for the currently loaded span
  Object.defineProperty(band, "length", {
    configurable: true,
    enumerable: true,
    get() {
      const r = currentRings();
      if (r.length <= 1) return 0;
      const first = r[0].index;
      const last = r[r.length - 1].index;
      return arcToMeters(Math.max(0, last - first), ringStep);
    }
  });

  /* --- End centerline API ------------------------------------------------------ */

  const initialSpeed = 15;
  const craft: CraftState = {
    speed: initialSpeed,
    targetSpeed: initialSpeed,
    position: [...spawn.position] as Vec3,
    velocity: scale(spawn.forward, initialSpeed),
    forward: [...spawn.forward] as Vec3,
    right: [...spawn.right] as Vec3,
    up: [...spawn.up] as Vec3,
    angularVelocity: [0, 0, 0],
    crashed: false
  };

  const camera = createCameraRig(add(spawn.position, scale(spawn.forward, -10)));
  return { band: band as SimulationState["band"], camera, craft, spawn };
}

export function updateSimulation(
  state: SimulationState,
  params: SimulationParams,
  input: PlayerInput,
  dt: number
) {
  const { craft, band } = state;
  if (craft.crashed) {
    updateCameraRig(state.camera, craft.position, craft.forward, craft.right, craft.up, params.camera, dt);
    return;
  }

  const closestS = band.closestS;
  const ringStep = params.sandbox.ringStep;
  const chunkLength = params.sandbox.chunkLength;
  const sMeters = typeof closestS === "function" ? closestS(craft.position) : 0;
  let centerChunk = Math.floor(sMeters / chunkLength);
  ensureChunks(band, centerChunk);

  let rings = collectRings(band);
  if (rings.length === 0) {
    updateCameraRig(state.camera, craft.position, craft.forward, craft.right, craft.up, params.camera, dt);
    return;
  }

  const arc = metersToArc(sMeters, ringStep);
  const sample = interpolateRing(rings, arc);

  craft.targetSpeed = clamp(
    craft.targetSpeed + input.throttleDelta * dt * 25,
    MIN_SPEED,
    MAX_SPEED
  );

  // Stability towards the guide spline
  const forwardError = cross(craft.forward, sample.forward);
  const yawCorrection = dot(forwardError, craft.up) * ALIGNMENT_GAIN;
  const pitchCorrection = -dot(forwardError, craft.right) * ALIGNMENT_GAIN;
  const rollError = dot(cross(craft.up, sample.up), craft.forward) * ALIGNMENT_GAIN;

  craft.angularVelocity[0] += (input.rollDelta - rollError) * ROLL_CONTROL * dt;
  craft.angularVelocity[1] += (input.pitchDelta + pitchCorrection) * PITCH_CONTROL * dt;
  craft.angularVelocity[2] += (input.yawDelta - yawCorrection) * YAW_CONTROL * dt;

  const damping = Math.pow(CONTROL_DAMPING, dt);
  craft.angularVelocity[0] *= damping;
  craft.angularVelocity[1] *= damping;
  craft.angularVelocity[2] *= damping;

  const rollStep = craft.angularVelocity[0] * dt;
  const pitchStep = craft.angularVelocity[1] * dt;
  const yawStep = craft.angularVelocity[2] * dt;

  if (Math.abs(yawStep) > 1e-5) {
    craft.forward = rotateAroundAxis(craft.forward, craft.up, yawStep);
    craft.right = rotateAroundAxis(craft.right, craft.up, yawStep);
  }
  if (Math.abs(pitchStep) > 1e-5) {
    craft.forward = rotateAroundAxis(craft.forward, craft.right, pitchStep);
    craft.up = rotateAroundAxis(craft.up, craft.right, pitchStep);
  }
  if (Math.abs(rollStep) > 1e-5) {
    craft.right = rotateAroundAxis(craft.right, craft.forward, rollStep);
    craft.up = rotateAroundAxis(craft.up, craft.forward, rollStep);
  }

  const basis = orthonormalize(craft.forward, craft.up);
  craft.forward = basis.forward;
  craft.right = basis.right;
  craft.up = basis.up;

  const speed = length(craft.velocity);
  craft.speed = speed;
  const speedError = craft.targetSpeed - speed;
  const thrustMagnitude = Math.max(0, BASE_THRUST + speedError * THRUST_GAIN);
  const thrust = scale(craft.forward, thrustMagnitude);
  const lift = scale(craft.up, LIFT_COEF * speed * speed);
  const drag: Vec3 = speed > 0 ? scale(craft.velocity, -DRAG_COEF * speed) : [0, 0, 0];

  const toCenter = sub(craft.position, sample.position);
  const axialOffset = dot(toCenter, sample.forward);
  const axialComponent = scale(sample.forward, axialOffset);
  const radial = sub(toCenter, axialComponent);
  const radialForce = scale(radial, -RADIAL_SPRING);
  const velAxial = dot(craft.velocity, sample.forward);
  const radialVelocity = sub(craft.velocity, scale(sample.forward, velAxial));
  const radialDampingForce = scale(radialVelocity, -RADIAL_DAMPING);

  let totalForce = add(thrust, lift);
  totalForce = add(totalForce, drag);
  totalForce = add(totalForce, GRAVITY);
  totalForce = add(totalForce, radialForce);
  totalForce = add(totalForce, radialDampingForce);

  const acceleration = scale(totalForce, 1 / MASS);
  craft.velocity = add(craft.velocity, scale(acceleration, dt));
  craft.position = add(craft.position, scale(craft.velocity, dt));
  craft.speed = length(craft.velocity);

  const sAfter = typeof closestS === "function" ? closestS(craft.position) : sMeters;
  const newCenterChunk = Math.floor(sAfter / chunkLength);
  if (newCenterChunk !== centerChunk) {
    centerChunk = newCenterChunk;
    ensureChunks(band, centerChunk);
  }

  rings = collectRings(band);
  const arcAfter = metersToArc(sAfter, ringStep);
  resolveTerrainCollision(craft, rings, params.craftRadius, arcAfter, ringStep);

  updateCameraRig(state.camera, craft.position, craft.forward, craft.right, craft.up, params.camera, dt);
}
  