import { describe, expect, it } from "vitest";
import { CubeQuadtreeLod } from "./quadtree";
import { parsePlanetSpec } from "./planetSpec";

const spec = parsePlanetSpec({
  radius: 1000,
  atmosphereHeight: 200,
  seaLevel: 1005,
  seed: 42,
  displacementLayers: [{ frequency: 2, amplitude: 10 }],
  temperatureFrequency: 0.5,
  moistureFrequency: 0.4,
  lodScreenError: [60, 30, 15, 7.5],
  scatterBudgetPerLod: [1, 2, 4, 8],
});

describe("CubeQuadtreeLod", () => {
  it("refines near camera", () => {
    const lod = new CubeQuadtreeLod(spec);
    const selection = lod.select({ position: { x: 0, y: 0, z: spec.radius + 10 }, fov: Math.PI / 3, viewportHeight: 1080 });
    expect(selection.selected.length).toBeGreaterThan(6);
  });
});
