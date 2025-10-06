import { describe, expect, it } from "vitest";
import { PlanetVehicleIntegrator } from "./vehicleIntegration";
import { parsePlanetSpec } from "./planetSpec";

const spec = parsePlanetSpec({
  radius: 1000,
  atmosphereHeight: 200,
  seaLevel: 990,
  seed: 21,
  displacementLayers: [{ frequency: 2, amplitude: 10 }],
  temperatureFrequency: 0.4,
  moistureFrequency: 0.6,
  lodScreenError: [30, 15, 7.5],
  scatterBudgetPerLod: [1, 2, 4],
});

describe("PlanetVehicleIntegrator", () => {
  it("prevents vehicles tunnelling underground", () => {
    const integrator = new PlanetVehicleIntegrator(spec, { clearance: 5, maxDt: 0.1 });
    const result = integrator.integrate(
      {
        position: { x: 0, y: 0, z: spec.radius + 1 },
        velocity: { x: 0, y: 0, z: -10 },
      },
      { x: 0, y: 0, z: -50 },
      0.1,
    );
    const sampleRadius = Math.hypot(result.position.x, result.position.y, result.position.z);
    expect(sampleRadius).toBeGreaterThanOrEqual(spec.radius - 1);
  });
});
