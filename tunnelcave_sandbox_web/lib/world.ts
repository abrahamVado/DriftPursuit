import type { SandboxParams } from "./config";
import { createChunkBand, ensureChunks, type ChunkBand } from "./streaming";
import { chooseSpawn, type SpawnPose } from "./probe";
import type { RingStation } from "./terrain";
import {
  computeCameraGoal,
  createCameraRig,
  type CameraMode,
  type CameraParams,
  type CameraRig,
  updateCameraRig
} from "./camera";
import {
  cross,
  length,
  normalize,
  rotateAroundAxis,
  scale,
  Vec3,
  lerp
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
  yaw: number;
  yawRate: number;
  pitch: number;
  pitchRate: number;
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
  viewMode: CameraMode;
  currentRingRadius: number;
}

export interface PlayerInput {
  throttleDelta: number;
  rollDelta: number;
  yawDelta: number;
  pitchDelta: number;
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
  frame: {
    forward: Vec3;
    right: Vec3;
    up: Vec3;
  };
  radius: number;
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
  const radius = base.radius + (next.radius - base.radius) * t;
  return { position, frame: { forward, right, up }, radius };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function reorthonormalize(forward: Vec3, right: Vec3, fallbackUp: Vec3) {
  forward = normalize(forward);
  right = normalize(right);
  let up = cross(forward, right);
  const upLen = length(up);
  if (upLen < 1e-5) {
    up = normalize(fallbackUp);
  } else {
    up = scale(up, 1 / upLen);
  }
  right = cross(up, forward);
  return { forward, right, up };
}

function applyOrientation(
  baseRight: Vec3,
  baseUp: Vec3,
  baseForward: Vec3,
  yaw: number,
  pitch: number,
  roll: number
) {
  let forward = baseForward;
  let right = baseRight;
  let up = baseUp;

  if (Math.abs(yaw) > 1e-6) {
    forward = rotateAroundAxis(forward, up, yaw);
    right = rotateAroundAxis(right, up, yaw);
    const ortho = reorthonormalize(forward, right, up);
    forward = ortho.forward;
    right = ortho.right;
    up = ortho.up;
  }

  if (Math.abs(pitch) > 1e-6) {
    forward = rotateAroundAxis(forward, right, pitch);
    up = rotateAroundAxis(up, right, pitch);
    const ortho = reorthonormalize(forward, right, up);
    forward = ortho.forward;
    right = ortho.right;
    up = ortho.up;
  }

  if (Math.abs(roll) > 1e-6) {
    right = rotateAroundAxis(right, forward, roll);
    up = rotateAroundAxis(up, forward, roll);
    const ortho = reorthonormalize(forward, right, up);
    forward = ortho.forward;
    right = ortho.right;
    up = ortho.up;
  }

  return { forward, right, up };
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
    yaw: 0,
    yawRate: 0,
    pitch: 0,
    pitchRate: 0,
    position: spawn.position,
    forward: spawn.forward,
    right: spawn.right,
    up: spawn.up
  };
  const initialGoal = computeCameraGoal(
    craft.position,
    craft.forward,
    craft.right,
    craft.up,
    params.camera,
    "third",
    spawn.ringRadius,
    params.sandbox.roughAmp
  );
  const camera = createCameraRig(initialGoal.position);
  camera.target = [...initialGoal.target];
  return { band, camera, craft, spawn, viewMode: "third", currentRingRadius: spawn.ringRadius };
}

export function updateSimulation(
  state: SimulationState,
  params: SimulationParams,
  input: PlayerInput,
  dt: number
) {
  const { craft, band } = state;
  craft.targetSpeed = clamp(craft.targetSpeed + input.throttleDelta * dt * 15, 2, 80);
  craft.speed += (craft.targetSpeed - craft.speed) * Math.min(1, dt * 2);
  craft.rollRate += input.rollDelta * dt * 2.5;
  craft.rollRate *= Math.pow(0.4, dt);
  craft.roll = clamp(craft.roll + craft.rollRate * dt, -Math.PI / 3, Math.PI / 3);
  craft.yawRate += input.yawDelta * dt * 2;
  craft.yawRate *= Math.pow(0.4, dt);
  craft.yaw = clamp(craft.yaw + craft.yawRate * dt, -Math.PI / 4, Math.PI / 4);
  craft.pitchRate += input.pitchDelta * dt * 2;
  craft.pitchRate *= Math.pow(0.4, dt);
  craft.pitch = clamp(craft.pitch + craft.pitchRate * dt, -Math.PI / 5, Math.PI / 5);
  const deltaArc = (craft.speed * dt) / params.sandbox.ringStep;
  craft.arc += deltaArc;
  const centerChunk = Math.floor((craft.arc * params.sandbox.ringStep) / params.sandbox.chunkLength);
  ensureChunks(band, centerChunk);
  const rings = collectRings(band);
  const sample = interpolateRing(rings, craft.arc);
  const oriented = applyOrientation(
    sample.frame.right,
    sample.frame.up,
    sample.frame.forward,
    craft.yaw,
    craft.pitch,
    craft.roll
  );
  craft.position = sample.position;
  craft.forward = oriented.forward;
  craft.right = oriented.right;
  craft.up = oriented.up;
  state.currentRingRadius = sample.radius;
  updateCameraRig(
    state.camera,
    craft.position,
    craft.forward,
    craft.right,
    craft.up,
    params.camera,
    dt,
    state.viewMode,
    sample.radius,
    params.sandbox.roughAmp
  );
}
