import { curlNoise, fbmNoise } from "./noise";
import { hashMix, randUnitVector } from "./prng";
import { add, normalize, scale, Vec3 } from "./vector";
import type { SandboxParams } from "./config";

export interface DirectionSample {
  forward: Vec3;
  radius: number;
  maxRadius: number;
  roughness: (theta: number) => number;
}

interface DirectionState {
  forward: Vec3;
  smoothForward: Vec3;
  distance: number;
  nextJolt: number;
  chunkSeed: number;
  arc: number;
}

export function createDirectionState(params: SandboxParams): DirectionState {
  return {
    forward: [0, 0, 1],
    smoothForward: [0, 0, 1],
    distance: 0,
    nextJolt: params.joltEveryMeters,
    chunkSeed: hashMix(params.worldSeed),
    arc: 0
  };
}

function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let wrapped = ((angle + Math.PI) % twoPi + twoPi) % twoPi;
  wrapped -= Math.PI;
  return wrapped;
}

function lobeContribution(theta: number, params: SandboxParams): number {
  const { profile } = params;
  if (profile.lobeWidth <= 0) {
    return 0;
  }
  const count = Math.min(profile.lobeCenters.length, profile.lobeStrengths.length);
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    const center = profile.lobeCenters[i];
    const strength = profile.lobeStrengths[i];
    const diff = wrapAngle(theta - center);
    const falloff = Math.exp(-0.5 * (diff / profile.lobeWidth) ** 2);
    total += strength * falloff;
  }
  return total;
}

function computeTwist(params: SandboxParams, state: DirectionState): number {
  const { profile } = params;
  if (profile.twistStrength <= 0 || profile.twistFrequency <= 0) {
    return 0;
  }
  const sample = fbmNoise(
    state.chunkSeed + 313,
    [state.arc * profile.twistFrequency, 0, 0],
    3,
    1,
    0.5
  );
  return sample * profile.twistStrength;
}

function fractalRockiness(
  params: SandboxParams,
  state: DirectionState,
  position: Vec3,
  theta: number
): number {
  const { profile } = params;
  const base: Vec3 = [
    position[0] * params.roughFreq,
    position[1] * params.roughFreq,
    state.arc * params.roughFreq
  ];
  return fbmNoise(
    state.chunkSeed + 997,
    [
      base[0] + Math.cos(theta) * profile.baseScale,
      base[1] + Math.sin(theta) * profile.baseScale,
      base[2] + Math.sin(theta * 0.5) * profile.baseScale
    ],
    profile.fractalOctaves,
    1,
    profile.fractalGain,
    profile.fractalLacunarity
  );
}

function buildRadiusSample(
  params: SandboxParams,
  state: DirectionState,
  position: Vec3
): {
  baseRadius: number;
  compute: (theta: number) => number;
  maxRadius: number;
} {
  const { profile } = params;
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
  const scaledBase = Math.max(
    (params.radiusBase + radiusNoise * params.radiusVar) * profile.baseScale,
    params.radiusBase * 0.4
  );
  const twist = computeTwist(params, state);
  const compute = (theta: number) => {
    const shifted = theta + twist;
    const lobe = lobeContribution(shifted, params);
    const cavernRadius = scaledBase * (1 + lobe);
    const rock = fractalRockiness(params, state, position, shifted);
    const finalRadius = Math.max(cavernRadius + params.roughAmp * rock, scaledBase * 0.45);
    return finalRadius;
  };
  let maxRadius = scaledBase;
  for (let i = 0; i < params.tubeSides; i += 1) {
    const theta = (i / params.tubeSides) * Math.PI * 2;
    maxRadius = Math.max(maxRadius, compute(theta));
  }
  return { baseRadius: scaledBase, compute, maxRadius };
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
  const radiusSample = buildRadiusSample(params, state, position);
  const roughness = (theta: number) => radiusSample.compute(theta) - radiusSample.baseRadius;
  const result = {
    forward,
    radius: radiusSample.baseRadius,
    maxRadius: radiusSample.maxRadius,
    roughness
  };
  state.arc += params.ringStep;
  return result;
}
