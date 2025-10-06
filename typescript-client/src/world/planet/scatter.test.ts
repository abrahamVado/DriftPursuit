import { describe, expect, it } from "vitest";
import { scatterInstances } from "./scatter";
import { parsePlanetSpec } from "./planetSpec";

const spec = parsePlanetSpec({
  radius: 1000,
  atmosphereHeight: 200,
  seaLevel: 990,
  seed: 99,
  displacementLayers: [{ frequency: 2, amplitude: 15 }],
  temperatureFrequency: 0.4,
  moistureFrequency: 0.6,
  lodScreenError: [30, 15, 7.5],
  scatterBudgetPerLod: [1, 3, 5],
});

describe("scatterInstances", () => {
  it("generates deterministic ids", () => {
    const a = scatterInstances(spec, { face: 0, i: 0, j: 0, lod: 1 });
    const b = scatterInstances(spec, { face: 0, i: 0, j: 0, lod: 1 });
    expect(a.map((item) => item.id)).toEqual(b.map((item) => item.id));
  });
});
