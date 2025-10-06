import { describe, expect, it } from "vitest";

import { parsePlanetSpec } from "./planetSpec";
import { PlanetFlightModel, computeLocalTangentBasis } from "./flightModel";

const spec = parsePlanetSpec({
  radius: 1000,
  atmosphereHeight: 200,
  seaLevel: 980,
  seed: 7,
  displacementLayers: [
    { frequency: 1.5, amplitude: 10 },
    { frequency: 3.0, amplitude: 5 },
  ],
  temperatureFrequency: 0.3,
  moistureFrequency: 0.5,
  lodScreenError: [30, 15, 7.5],
  scatterBudgetPerLod: [1, 2, 4],
});

describe("computeLocalTangentBasis", () => {
  it("produces orthonormal axes even close to the poles", () => {
    const basis = computeLocalTangentBasis({ x: 0.2, y: spec.radius + 20, z: 0.1 });
    const forwardLength = Math.hypot(basis.forward.x, basis.forward.y, basis.forward.z);
    const rightLength = Math.hypot(basis.right.x, basis.right.y, basis.right.z);
    const upLength = Math.hypot(basis.up.x, basis.up.y, basis.up.z);
    expect(forwardLength).toBeCloseTo(1, 3);
    expect(rightLength).toBeCloseTo(1, 3);
    expect(upLength).toBeCloseTo(1, 3);
    const dotFR =
      basis.forward.x * basis.right.x +
      basis.forward.y * basis.right.y +
      basis.forward.z * basis.right.z;
    const dotFU =
      basis.forward.x * basis.up.x + basis.forward.y * basis.up.y + basis.forward.z * basis.up.z;
    const dotRU = basis.right.x * basis.up.x + basis.right.y * basis.up.y + basis.right.z * basis.up.z;
    expect(dotFR).toBeCloseTo(0, 3);
    expect(dotFU).toBeCloseTo(0, 3);
    expect(dotRU).toBeCloseTo(0, 3);
  });
});

describe("PlanetFlightModel", () => {
  it("autopilot maintains constant longitude while flying due south", () => {
    const model = new PlanetFlightModel(spec, { maxSpeed: 120, thrustAcceleration: 40 });
    let state = {
      position: { x: spec.radius + 20, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      ...computeLocalTangentBasis({ x: spec.radius + 20, y: 0, z: 0 }),
    };
    const axis = { x: 0, y: 1, z: 0 };
    const planeNormal = normaliseVec(crossVec(state.position, axis));
    let maxPlaneOffset = 0;
    for (let i = 0; i < 400; i += 1) {
      state = model.step(
        state,
        { throttle: 0.6, pitch: 0, yaw: 0, roll: 0, autopilotSouth: true },
        0.1,
      );
      const planeDistance = Math.abs(
        state.position.x * planeNormal.x +
          state.position.y * planeNormal.y +
          state.position.z * planeNormal.z,
      );
      maxPlaneOffset = Math.max(maxPlaneOffset, planeDistance);
      const altitude = Math.hypot(state.position.x, state.position.y, state.position.z) - spec.radius;
      expect(altitude).toBeGreaterThanOrEqual(0);
      expect(altitude).toBeLessThanOrEqual(spec.atmosphereHeight + 1);
    }
    expect(maxPlaneOffset).toBeLessThan(1e-3);
  });

  it("applies stronger drag near the surface than near the ceiling", () => {
    const model = new PlanetFlightModel(spec, { dragCoefficient: 0.05, maxSpeed: 200 });
    const startBasis = computeLocalTangentBasis({ x: spec.radius + 10, y: 0, z: 0 });
    const lowState = {
      position: { x: spec.radius + 10, y: 0, z: 0 },
      velocity: { x: 0, y: 150, z: 0 },
      ...startBasis,
    };
    const highState = {
      position: { x: spec.radius + spec.atmosphereHeight - 1, y: 0, z: 0 },
      velocity: { x: 0, y: 150, z: 0 },
      ...startBasis,
    };
    const nextLow = model.step(lowState, { throttle: 0, pitch: 0, yaw: 0, roll: 0 }, 0.5);
    const nextHigh = model.step(highState, { throttle: 0, pitch: 0, yaw: 0, roll: 0 }, 0.5);
    const lowSpeed = Math.hypot(nextLow.velocity.x, nextLow.velocity.y, nextLow.velocity.z);
    const highSpeed = Math.hypot(nextHigh.velocity.x, nextHigh.velocity.y, nextHigh.velocity.z);
    expect(lowSpeed).toBeLessThan(highSpeed);
  });
});

function crossVec(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  //1.- Reuse a lightweight vector cross product tailored for the test assertions.
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normaliseVec(v: { x: number; y: number; z: number }) {
  //1.- Provide a deterministic normalisation helper for validating plane constraints.
  const length = Math.hypot(v.x, v.y, v.z);
  if (length === 0) {
    return { x: 0, y: 0, z: 1 };
  }
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

