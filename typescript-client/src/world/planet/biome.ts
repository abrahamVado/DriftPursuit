import { DeterministicFbm } from "./noise";
import type { PlanetSpec } from "./planetSpec";

export type Biome =
  | "ocean"
  | "desert"
  | "savanna"
  | "forest"
  | "tundra"
  | "glacier";

export interface BiomeSample {
  //1.- Biome string identifier controlling material selection.
  biome: Biome;
  //2.- Derived low frequency temperature metric.
  temperature: number;
  //3.- Derived low frequency moisture metric.
  moisture: number;
}

export class PlanetBiomes {
  private readonly spec: PlanetSpec;
  private readonly temperatureNoise: DeterministicFbm;
  private readonly moistureNoise: DeterministicFbm;

  constructor(spec: PlanetSpec) {
    //1.- Reuse the deterministic FBM but offset seeds so fields remain decorrelated.
    this.spec = spec;
    const temperatureSpec = {
      ...spec,
      displacementLayers: spec.displacementLayers.map((layer, index) => ({
        frequency: layer.frequency * spec.temperatureFrequency,
        amplitude: layer.amplitude,
      })),
      seed: spec.seed + 7,
    };
    const moistureSpec = {
      ...spec,
      displacementLayers: spec.displacementLayers.map((layer, index) => ({
        frequency: layer.frequency * spec.moistureFrequency,
        amplitude: layer.amplitude,
      })),
      seed: spec.seed + 13,
    };
    this.temperatureNoise = new DeterministicFbm(temperatureSpec);
    this.moistureNoise = new DeterministicFbm(moistureSpec);
  }

  sample(direction: { x: number; y: number; z: number }, elevation: number): BiomeSample {
    //1.- Evaluate climate fields and remap them into [-1, 1].
    const temperature = this.temperatureNoise.sample(direction);
    const moisture = this.moistureNoise.sample(direction);
    //2.- Adjust for elevation so high mountains become colder and drier.
    const lapseRate = Math.max(0, 1 - elevation / (this.spec.atmosphereHeight + this.spec.radius));
    const adjustedTemperature = temperature * lapseRate;
    const adjustedMoisture = moisture * (0.7 + 0.3 * lapseRate);
    //3.- Map the combination to a discrete biome label.
    const biome = resolveBiome(adjustedTemperature, adjustedMoisture, elevation < this.spec.seaLevel);
    return { biome, temperature: adjustedTemperature, moisture: adjustedMoisture };
  }
}

function resolveBiome(temperature: number, moisture: number, isUnderSea: boolean): Biome {
  //1.- Oceans override all land biomes regardless of moisture/temperature ratios.
  if (isUnderSea) {
    return "ocean";
  }
  if (temperature < -0.4) {
    return moisture > 0 ? "glacier" : "tundra";
  }
  if (temperature < 0.2) {
    return moisture > 0.3 ? "forest" : "savanna";
  }
  if (temperature < 0.6) {
    return moisture < -0.2 ? "savanna" : "forest";
  }
  return moisture < 0 ? "desert" : "savanna";
}
