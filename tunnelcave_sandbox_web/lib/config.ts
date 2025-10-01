export interface SandboxParams {
  worldSeed: number;
  chunkLength: number;
  ringStep: number;
  tubeSides: number;
  dirFreq: number;
  dirBlend: number;
  radiusBase: number;
  radiusVar: number;
  radiusFreq: number;
  roughAmp: number;
  roughFreq: number;
  joltEveryMeters: number;
  joltStrength: number;
  maxTurnPerStepRad: number;
}

export const defaultParams: SandboxParams = {
  worldSeed: 1337,
  chunkLength: 80,
  ringStep: 2.5,
  tubeSides: 18,
  dirFreq: 0.05,
  dirBlend: 0.65,
  radiusBase: 9,
  radiusVar: 2.5,
  radiusFreq: 0.017,
  roughAmp: 0.65,
  roughFreq: 0.18,
  joltEveryMeters: 120,
  joltStrength: 0.55,
  maxTurnPerStepRad: Math.PI / 6
};
