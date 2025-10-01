import { curlNoise, fbmNoise } from "./noise";
import { hashMix, randUnitVector } from "./prng";
import { add, normalize, scale, Vec3 } from "./vector";
import type { SandboxParams } from "./config";

export interface DirectionSample {
  forward: Vec3;
  radius: number;
  roughness: (theta: number) => number;
}

interface DirectionState {
  forward: Vec3;
  smoothForward: Vec3;
  distance: number;
  nextJolt: number;
  chunkSeed: number;
}

export function createDirectionState(params: SandboxParams): DirectionState {
  return {
    forward: [0, 0, 1],
    smoothForward: [0, 0, 1],
    distance: 0,
    nextJolt: params.joltEveryMeters,
    chunkSeed: hashMix(params.worldSeed)
  };
}

function sampleDirectionField(
  params: SandboxParams,
  state: DirectionState,
  position: Vec3
): Vec3 {
  const scaled: Vec3 = [
    position[0] * params.dirFreq,
    position[1] * params.dirFreq,
    position[2] * params.dirFreq
  ];
  const curl = curlNoise(state.chunkSeed, scaled);
  return normalize(curl);
}

function applyJolts(
  params: SandboxParams,
  state: DirectionState,
  rand: () => number
): Vec3 {
  let forward = state.forward;
  state.distance += params.ringStep;
  if (state.distance >= state.nextJolt) {
    const impulse = randUnitVector(rand);
    forward = normalize(add(forward, scale(impulse, params.joltStrength)));
    state.nextJolt += params.joltEveryMeters * (0.4 + rand() * 1.2);
  }
  return forward;
}

export function stepDirection(
  params: SandboxParams,
  state: DirectionState,
  position: Vec3,
  rand: () => number
): DirectionSample {
  const fieldDir = sampleDirectionField(params, state, position);
  const blended = normalize(
    add(scale(state.smoothForward, params.dirBlend), scale(fieldDir, 1 - params.dirBlend))
  );
  let forward = blended;
  const jolted = applyJolts(params, state, rand);
  forward = normalize(add(scale(forward, 0.7), scale(jolted, 0.3)));
  const turnAngle = Math.acos(
    Math.min(
      1,
      Math.max(-1, state.forward[0] * forward[0] + state.forward[1] * forward[1] + state.forward[2] * forward[2])
    )
  );
  if (turnAngle > params.maxTurnPerStepRad) {
    const t = params.maxTurnPerStepRad / turnAngle;
    forward = normalize(add(scale(state.forward, 1 - t), scale(forward, t)));
  }
  state.forward = forward;
  state.smoothForward = forward;
  const radiusNoise = fbmNoise(
    state.chunkSeed + 211,
    [
      position[0] * params.radiusFreq,
      position[1] * params.radiusFreq,
      position[2] * params.radiusFreq
    ],
    4,
    1,
    0.5
  );
  const radius = params.radiusBase + radiusNoise * params.radiusVar;
  const roughness = (theta: number) => {
    const sample = fbmNoise(
      state.chunkSeed + 997,
      [
        position[0] * params.roughFreq + Math.cos(theta) * 1.5,
        position[1] * params.roughFreq + Math.sin(theta) * 1.5,
        position[2] * params.roughFreq
      ],
      3,
      1,
      0.5
    );
    return sample * params.roughAmp;
  };
  return { forward, radius, roughness };
}
