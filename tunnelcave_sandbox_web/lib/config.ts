export interface CavernProfileParams {
  baseScale: number;
  lobeCenters: number[];
  lobeStrengths: number[];
  lobeWidth: number;
  fractalOctaves: number;
  fractalGain: number;
  fractalLacunarity: number;
  twistFrequency: number;
  twistStrength: number;
}
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
  profile: CavernProfileParams;

}

export const defaultParams: SandboxParams = {
  worldSeed: 1337,
  chunkLength: 90,
  ringStep: 3,
  tubeSides: 20,
  dirFreq: 0.05,
  dirBlend: 0.65,
  radiusBase: 11,
  radiusVar: 3,
  radiusFreq: 0.014,
  roughAmp: 1.1,
  roughFreq: 0.14,
  joltEveryMeters: 140,
  joltStrength: 0.45,
  maxTurnPerStepRad: Math.PI / 6,
  profile: {
    baseScale: 1.35,
    lobeCenters: [Math.PI / 2, (3 * Math.PI) / 2],
    lobeStrengths: [0.95, 0.95],
    lobeWidth: 1.15,
    fractalOctaves: 4,
    fractalGain: 0.55,
    fractalLacunarity: 2.1,
    twistFrequency: 0.03,
    twistStrength: 0.72
  }
};
