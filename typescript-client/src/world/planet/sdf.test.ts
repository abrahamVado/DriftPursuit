import { describe, expect, it } from "vitest";
import { PlanetSdf } from "./sdf";
import { parsePlanetSpec } from "./planetSpec";

const spec = parsePlanetSpec({
  radius: 1000,
  atmosphereHeight: 200,
  seaLevel: 1002,
  seed: 987,
  displacementLayers: [{ frequency: 2, amplitude: 10 }],
  temperatureFrequency: 0.3,
  moistureFrequency: 0.5,
  lodScreenError: [30, 15, 7.5],
  scatterBudgetPerLod: [1, 2, 4],
});

describe("PlanetSdf", () => {
  it("samples distance and normal", () => {
    const sdf = new PlanetSdf(spec);
    const sample = sdf.sample({ x: 0, y: 0, z: spec.radius + 5 });
    expect(sample.distance).toBeGreaterThan(-20);
    expect(sample.normal.z).toBeGreaterThan(0.5);
  });

  it("clamps altitude within shell", () => {
    const sdf = new PlanetSdf(spec);
    const clamped = sdf.clampAltitude({ x: 0, y: 0, z: spec.radius * 2 }, 5);
    const maxRadius = spec.radius + spec.atmosphereHeight;
    expect(Math.hypot(clamped.clamped.x, clamped.clamped.y, clamped.clamped.z)).toBeLessThanOrEqual(maxRadius + 1e-3);
  });
});
