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
  fieldType: "straight" | "curl";
  dirFreq: number;
  dirBlend: number;
  radiusBase: number;
  radiusVar: number;
  radiusFreq: number;
  roughAmp: number;
  roughFreq: number;
  roughSmoothness: number;
  roughFilterKernel: number[] | null;
  joltEveryMeters: number;
  joltStrength: number;
  maxTurnPerStepRad: number;
  profile: CavernProfileParams;
  addEndCaps: boolean;

}

export const defaultParams: SandboxParams = {
  worldSeed: 1337,
  chunkLength: 90,
  ringStep: 3,
  tubeSides: 20,
  fieldType: "straight",
  dirFreq: 0.05,
  dirBlend: 0.65,
  radiusBase: 11,
  radiusVar: 1.2,
  radiusFreq: 0.008,
  roughAmp: 1.1,
  roughFreq: 0.14,
  roughSmoothness: 0.45,
  roughFilterKernel: [0.2, 0.6, 0.2],
  joltEveryMeters: 140,
  joltStrength: 0.45,
  maxTurnPerStepRad: Math.PI / 6,
  addEndCaps: true,
  profile: {

    baseScale: 1.3,
    lobeCenters: [Math.PI / 2, (3 * Math.PI) / 2],
    lobeStrengths: [1.05, 1.05],
    lobeWidth: 1.35,
    fractalOctaves: 0,
    fractalGain: 0,
    fractalLacunarity: 2.1,
    twistFrequency: 0.018,
    twistStrength: 0.6

  }
};
