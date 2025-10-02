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
  scale,
  sub,
  Vec3,
  lerp,
  copy,
  rotateAroundAxis
} from "./vector";

export interface SimulationParams {
  sandbox: SandboxParams;
  camera: CameraParams;
  craftRadius: number;
}

export interface CraftState {
  arc: number;
  speed: number;
  targetSpeed: number;
  roll: number;
  rollRate: number;
  velocity: Vec3;
  position: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  enteredInterior: boolean;
}

export interface SimulationState {
  band: ChunkBand & {
    // Centerline API we attach at runtime (meters-based):
    centerAt?: (sMeters: number) => Vec3;
    tangentAt?: (sMeters: number) => Vec3;
    closestS?: (p: Vec3 | { x: number; y: number; z: number }) => number;
    length?: number; // getter (meters) over currently loaded rings
    sample?: (sMeters: number) => { position: Vec3; tangent: Vec3 };
  };
  camera: CameraRig;
  craft: CraftState;
  spawn: SpawnPose;
  assistEnabled: boolean;
  mouth: MouthConstraint;
}

export interface PlayerInput {
  throttle: number;
  pitch: number;
  yaw: number;
  roll: number;
  vertical: number;
  boost: boolean;
  assistEnabled: boolean;
  reset: boolean;
}

const WORLD_UP: Vec3 = [0, 0, 1];
const ASSIST_SPEED_LIMITS = { min: 2, max: 80 };
const FREE_FLIGHT = {
  throttleAccel: 45,
  boostAccel: 55,
  verticalAccel: 38,
  drag: 0.45,
  boostDrag: 0.28,
  baseSpeedLimit: 120,
  boostSpeedLimit: 170,
  rollRate: Math.PI * 1.1,
  pitchRate: Math.PI * 0.8,
  yawRate: Math.PI * 0.6,
};

interface MouthConstraint {
  origin: Vec3;
  normal: Vec3;
  radius: number;
  cushion: number;
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

function applyRoll(right: Vec3, up: Vec3, forward: Vec3, roll: number) {
  const cos = Math.cos(roll);
  const sin = Math.sin(roll);
  const newRight: Vec3 = [
    right[0] * cos + up[0] * sin,
    right[1] * cos + up[1] * sin,
    right[2] * cos + up[2] * sin
  ];
  const newUp: Vec3 = [
    up[0] * cos - right[0] * sin,
    up[1] * cos - right[1] * sin,
    up[2] * cos - right[2] * sin
  ];
  return { right: newRight, up: newUp, forward };
}

function estimateRingRadius(ring: RingStation, samples = 32): number {
  let maxRadius = 0;
  for (let i = 0; i < samples; i += 1) {
    const theta = (i / samples) * Math.PI * 2;
    const radius = ring.radius + ring.roughness(theta);
    if (radius > maxRadius) {
      maxRadius = radius;
    }
  }
  return Math.max(0.1, maxRadius);
}

function createMouthConstraint(rings: RingStation[], craftRadius: number): MouthConstraint {
  if (!rings.length) {
    return {
      origin: [0, 0, 0],
      normal: [0, 0, 1],
      radius: 5,
      cushion: Math.max(0.5, craftRadius)
    };
  }

  let earliest = rings[0];
  for (const ring of rings) {
    if (ring.index < earliest.index) {
      earliest = ring;
    }
  }

  const radius = estimateRingRadius(earliest);
  const cushion = Math.max(0.5, craftRadius * 1.1);
  return {
    origin: copy(earliest.position),
    normal: normalize(copy(earliest.frame.forward)),
    radius,
    cushion
  };
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

/* ----------------------------------- Simulation ----------------------------------- */

export function createSimulation(params: SimulationParams): SimulationState {
  const band = createChunkBand(params.sandbox);
  ensureChunks(band, 0);
  const rings = collectRings(band);
  const spawn = chooseSpawn(rings, params.craftRadius);
  if (!spawn) {
    throw new Error("Failed to find spawn ring");
  }
  const mouth = createMouthConstraint(rings, params.craftRadius);

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
    return { position: s.position, tangent: s.forward };
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

  const craft: CraftState = {
    arc: spawn.ringIndex,
    speed: 15,
    targetSpeed: 15,
    roll: spawn.rollHint,
    rollRate: 0,
    velocity: scale(spawn.forward, 15),
    position: spawn.position,
    forward: spawn.forward,
    right: spawn.right,
    up: spawn.up,
    enteredInterior: true
  };

  const camera = createCameraRig(add(spawn.position, scale(spawn.forward, -10)));
  return {
    band: band as SimulationState["band"],
    camera,
    craft,
    spawn,
    assistEnabled: true,
    mouth
  };
}

function enforceMouthContainment(state: SimulationState, params: SimulationParams) {
  const { mouth, craft } = state;
  const clearance = mouth.radius - params.craftRadius;
  const safeRadius = Math.max(0, clearance - 0.25);

  const offset = sub(craft.position, mouth.origin);
  const axial = dot(offset, mouth.normal);
  const axialComponent = scale(mouth.normal, axial);
  const radial = sub(offset, axialComponent);
  const radialLength = length(radial);

  let clamped = false;
  let clampedAxial = axial;
  let clampedRadial = radial;

  if (!craft.enteredInterior && axial >= -mouth.cushion) {
    craft.enteredInterior = true;
  }

  if (craft.enteredInterior && axial < mouth.cushion) {
    clampedAxial = mouth.cushion;
    clamped = true;
    const outward = dot(craft.velocity, mouth.normal);
    if (outward < 0) {
      craft.velocity = add(craft.velocity, scale(mouth.normal, -outward));
    }
  }

  const nearEntrance = axial < mouth.radius * 2;

  if (nearEntrance && radialLength > safeRadius) {
    clamped = true;
    if (radialLength > 1e-5) {
      const limit = safeRadius / radialLength;
      clampedRadial = scale(radial, limit);
      const radialNormal = normalize(radial);
      const radialSpeed = dot(craft.velocity, radialNormal);
      if (radialSpeed > 0) {
        craft.velocity = sub(craft.velocity, scale(radialNormal, radialSpeed));
      }
    } else {
      clampedRadial = [0, 0, 0] as Vec3;
    }
  }

  if (clamped) {
    craft.position = add(mouth.origin, add(scale(mouth.normal, clampedAxial), clampedRadial));
  }
}

export function updateSimulation(
  state: SimulationState,
  params: SimulationParams,
  input: PlayerInput,
  dt: number
) {
  if (dt <= 0) return;

  const { craft, band } = state;

  if (input.reset) {
    craft.arc = state.spawn.ringIndex;
    craft.speed = 15;
    craft.targetSpeed = 15;
    craft.roll = state.spawn.rollHint;
    craft.rollRate = 0;
    craft.position = copy(state.spawn.position);
    craft.forward = copy(state.spawn.forward);
    craft.right = copy(state.spawn.right);
    craft.up = copy(state.spawn.up);
    craft.velocity = scale(craft.forward, craft.speed);
    craft.enteredInterior = true;
    state.assistEnabled = true;
  }

  if (state.assistEnabled !== input.assistEnabled) {
    state.assistEnabled = input.assistEnabled;
    if (state.assistEnabled) {
      const sMeters = band.closestS
        ? band.closestS({ x: craft.position[0], y: craft.position[1], z: craft.position[2] })
        : craft.arc * params.sandbox.ringStep;
      craft.arc = metersToArc(sMeters, params.sandbox.ringStep);
      craft.roll = 0;
      craft.rollRate = 0;
      const rings = collectRings(band);
      const sample = interpolateRing(rings, craft.arc);
      craft.position = sample.position;
      craft.forward = sample.forward;
      craft.right = sample.right;
      craft.up = sample.up;
      craft.velocity = scale(craft.forward, craft.speed);
    } else {
      craft.velocity = scale(craft.forward, craft.speed);
    }
  }

  if (state.assistEnabled) {
    const throttleBoost = input.boost ? 0.8 : 0;
    craft.targetSpeed = Math.max(
      ASSIST_SPEED_LIMITS.min,
      Math.min(
        ASSIST_SPEED_LIMITS.max,
        craft.targetSpeed + (input.throttle + throttleBoost) * dt * 18
      )
    );
    craft.speed += (craft.targetSpeed - craft.speed) * Math.min(1, dt * 2.4);
    craft.rollRate += input.roll * dt * 2.5;
    craft.rollRate *= Math.pow(0.4, dt);
    craft.roll = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, craft.roll + craft.rollRate * dt));

    craft.arc += (craft.speed * dt) / params.sandbox.ringStep;
    const sMeters = craft.arc * params.sandbox.ringStep;
    const centerChunk = Math.floor(sMeters / params.sandbox.chunkLength);
    ensureChunks(band, centerChunk);

    const rings = collectRings(band);
    const sample = interpolateRing(rings, craft.arc);
    const rolled = applyRoll(sample.right, sample.up, sample.forward, craft.roll);

    craft.position = sample.position;
    craft.forward = rolled.forward;
    craft.right = rolled.right;
    craft.up = rolled.up;
    craft.velocity = scale(craft.forward, craft.speed);
  } else {
    const yawRate = input.yaw * FREE_FLIGHT.yawRate * dt;
    if (Math.abs(yawRate) > 0) {
      craft.forward = rotateAroundAxis(craft.forward, WORLD_UP, yawRate);
      craft.right = rotateAroundAxis(craft.right, WORLD_UP, yawRate);
      craft.up = rotateAroundAxis(craft.up, WORLD_UP, yawRate);
    }

    const pitchRate = input.pitch * FREE_FLIGHT.pitchRate * dt;
    if (Math.abs(pitchRate) > 0) {
      craft.forward = rotateAroundAxis(craft.forward, craft.right, pitchRate);
      craft.up = rotateAroundAxis(craft.up, craft.right, pitchRate);
    }

    const rollRate = input.roll * FREE_FLIGHT.rollRate * dt;
    if (Math.abs(rollRate) > 0) {
      craft.right = rotateAroundAxis(craft.right, craft.forward, rollRate);
      craft.up = rotateAroundAxis(craft.up, craft.forward, rollRate);
    }

    const forward = normalize(craft.forward);
    const right = normalize(cross(forward, craft.up));
    const up = normalize(cross(right, forward));
    craft.forward = forward;
    craft.right = right;
    craft.up = up;

    let acceleration = scale(forward, input.throttle * FREE_FLIGHT.throttleAccel);
    if (input.boost) {
      acceleration = add(acceleration, scale(forward, FREE_FLIGHT.boostAccel));
    }
    if (input.vertical !== 0) {
      acceleration = add(acceleration, scale(WORLD_UP, input.vertical * FREE_FLIGHT.verticalAccel));
    }

    craft.velocity = add(craft.velocity, scale(acceleration, dt));

    const drag = Math.exp(-dt * (input.boost ? FREE_FLIGHT.boostDrag : FREE_FLIGHT.drag));
    craft.velocity = scale(craft.velocity, drag);

    const maxSpeed = input.boost ? FREE_FLIGHT.boostSpeedLimit : FREE_FLIGHT.baseSpeedLimit;
    const speed = length(craft.velocity);
    if (speed > maxSpeed) {
      craft.velocity = scale(craft.velocity, maxSpeed / Math.max(speed, 1e-5));
    }

    craft.position = add(craft.position, scale(craft.velocity, dt));
    craft.speed = length(craft.velocity);
    craft.targetSpeed = craft.speed;
    craft.roll = 0;
    craft.rollRate = 0;
  }

  enforceMouthContainment(state, params);

  let sMeters = craft.arc * params.sandbox.ringStep;
  if (band.closestS) {
    sMeters = band.closestS({ x: craft.position[0], y: craft.position[1], z: craft.position[2] });
    craft.arc = metersToArc(sMeters, params.sandbox.ringStep);
  }
  const centerChunk = Math.floor(sMeters / params.sandbox.chunkLength);
  ensureChunks(band, centerChunk);

  updateCameraRig(state.camera, craft.position, craft.forward, craft.right, craft.up, params.camera, dt);
}
  