import { describe, expect, it } from "vitest";
import { PlanetBiomes } from "./biome";
import { parsePlanetSpec } from "./planetSpec";

const spec = parsePlanetSpec({
  radius: 1000,
  atmosphereHeight: 200,
  seaLevel: 990,
  seed: 77,
  displacementLayers: [{ frequency: 2, amplitude: 30 }],
  temperatureFrequency: 0.4,
  moistureFrequency: 0.6,
  lodScreenError: [30, 15, 7.5],
  scatterBudgetPerLod: [1, 2, 4],
});

describe("PlanetBiomes", () => {
  it("returns ocean below sea level", () => {
    const biomes = new PlanetBiomes(spec);
    const sample = biomes.sample({ x: 0, y: 0, z: 1 }, spec.seaLevel - 20);
    expect(sample.biome).toBe("ocean");
  });

  it("returns varied land biome", () => {
    const biomes = new PlanetBiomes(spec);
    const sample = biomes.sample({ x: 1, y: 0.5, z: 0.2 }, spec.radius + 50);
    expect(["forest", "savanna", "desert", "tundra", "glacier"].includes(sample.biome)).toBe(true);
  });
});
