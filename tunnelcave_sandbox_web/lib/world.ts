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
  band: ChunkBand;
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

export function createSimulation(params: SimulationParams): SimulationState {
  const band = createChunkBand(params.sandbox);
  ensureChunks(band, 0);
  const rings = collectRings(band);
  const spawn = chooseSpawn(rings, params.craftRadius);
  if (!spawn) {
    throw new Error("Failed to find spawn ring");
  }
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
  return { band, camera, craft, spawn };
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
