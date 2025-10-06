import { describe, expect, it } from "vitest";
import { buildCubeTileMesh, enumerateCircumnavigation } from "./cubedSphere";
import { parsePlanetSpec } from "./planetSpec";

const spec = parsePlanetSpec({
  radius: 1000,
  atmosphereHeight: 200,
  seaLevel: 1005,
  seed: 12345,
  displacementLayers: [{ frequency: 2, amplitude: 50 }],
  temperatureFrequency: 0.5,
  moistureFrequency: 0.4,
  lodScreenError: [30, 15, 7.5],
  scatterBudgetPerLod: [2, 4, 8],
});

describe("buildCubeTileMesh", () => {
  it("creates edge consistent mesh", () => {
    const mesh = buildCubeTileMesh(spec, { face: 0, i: 0, j: 0, lod: 2 });
    expect(mesh.vertices).toHaveLength(((1 << 2) + 1) ** 2);
    expect(mesh.indices.length % 3).toBe(0);
  });
});

describe("enumerateCircumnavigation", () => {
  it("produces reasonable arc length", () => {
    const length = enumerateCircumnavigation(spec, 64);
    const expectedCircumference = 2 * Math.PI * spec.radius;
    expect(Math.abs(length - expectedCircumference)).toBeLessThan(expectedCircumference * 0.05);
  });
});
