import type { SandboxParams } from "./config";
import { createChunkBand, ensureChunks, type ChunkBand } from "./streaming";
import { chooseSpawn, type SpawnPose } from "./probe";
import type { RingStation } from "./terrain";
import { createCameraRig, type CameraParams, type CameraRig, updateCameraRig } from "./camera";
import { add, cross, length, normalize, scale, Vec3, lerp } from "./vector";

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
  position: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
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
}

export interface PlayerInput {
  throttleDelta: number;
  rollDelta: number;
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
    position: spawn.position,
    forward: spawn.forward,
    right: spawn.right,
    up: spawn.up
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

  craft.targetSpeed = Math.max(2, Math.min(80, craft.targetSpeed + input.throttleDelta * dt * 15));
  craft.speed += (craft.targetSpeed - craft.speed) * Math.min(1, dt * 2);
  craft.rollRate += input.rollDelta * dt * 2.5;
  craft.rollRate *= Math.pow(0.4, dt);
  craft.roll = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, craft.roll + craft.rollRate * dt));

  const deltaArc = (craft.speed * dt) / params.sandbox.ringStep;
  craft.arc += deltaArc;

  const centerChunk = Math.floor((craft.arc * params.sandbox.ringStep) / params.sandbox.chunkLength);
  ensureChunks(band, centerChunk);

  const rings = collectRings(band);
  const sample = interpolateRing(rings, craft.arc);
  const rolled = applyRoll(sample.right, sample.up, sample.forward, craft.roll);

  craft.position = sample.position;
  craft.forward = rolled.forward;
  craft.right = rolled.right;
  craft.up = rolled.up;

  updateCameraRig(state.camera, craft.position, craft.forward, craft.right, craft.up, params.camera, dt);
}
  