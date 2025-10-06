import { describe, expect, it } from "vitest";
import { parsePlanetSpec } from "./planetSpec";

const validSpec = {
  radius: 1000,
  atmosphereHeight: 200,
  seaLevel: 1005,
  seed: 12345,
  displacementLayers: [
    { frequency: 2, amplitude: 50 },
    { frequency: 4, amplitude: 20 },
  ],
  temperatureFrequency: 0.5,
  moistureFrequency: 0.4,
  lodScreenError: [30, 15, 7.5],
  scatterBudgetPerLod: [2, 4, 8],
};

describe("parsePlanetSpec", () => {
  it("parses valid configuration", () => {
    const spec = parsePlanetSpec(validSpec);
    expect(spec.radius).toBe(1000);
    expect(spec.lodScreenError).toHaveLength(3);
  });

  it("throws for missing displacement", () => {
    expect(() => parsePlanetSpec({ ...validSpec, displacementLayers: [] })).toThrow();
  });
});
