import assert from "node:assert";
import { deriveStatsWithModifiers, skiffStats } from "../gameplayConfig";
import {
  GuidanceSpline,
  applyAssistAlignment,
  integrateVehicle,
  wrapAngleDeg,
  type VehicleStateLike,
} from "./integrator";

//1.- Verify the integrator advances both linear and angular state over a step.
{
  const state: VehicleStateLike = {
    position: { x: 1, y: 2, z: 3 },
    velocity: { x: 4, y: -2, z: 0.5 },
    orientation: { yawDeg: 10, pitchDeg: -5, rollDeg: 0 },
    angularVelocity: { x: 20, y: 30, z: -10 },
  };
  integrateVehicle(state, 0.5, skiffStats);
  assert.ok(Math.abs((state.position?.x ?? 0) - 3) < 1e-9, "unexpected x");
  assert.ok(Math.abs((state.position?.y ?? 0) - 1) < 1e-9, "unexpected y");
  assert.ok(Math.abs((state.position?.z ?? 0) - 3.25) < 1e-9, "unexpected z");
  assert.ok(Math.abs((state.orientation?.yawDeg ?? 0) - 25) < 1e-9, "unexpected yaw");
  assert.ok(Math.abs((state.orientation?.pitchDeg ?? 0) - 5) < 1e-9, "unexpected pitch");
  assert.ok(Math.abs((state.orientation?.rollDeg ?? 0) + 5) < 1e-9, "unexpected roll");
}

//2.- Confirm wrapAngleDeg keeps values within the inclusive-exclusive range.
{
  assert.strictEqual(wrapAngleDeg(540), -180 + 0, "540 should wrap to -180");
  assert.ok(wrapAngleDeg(-725) >= -180 && wrapAngleDeg(-725) < 180, "wrapped range");
}

//3.- Ensure assist alignment reorients the craft along the spline.
{
  const spline = new GuidanceSpline([
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 5, z: 5 },
  ]);
  const state: VehicleStateLike = {
    position: { x: 0, y: 0, z: 0 },
    orientation: { yawDeg: -90, pitchDeg: 0, rollDeg: 30 },
    angularVelocity: { x: 15, y: -40, z: 5 },
    flightAssistEnabled: true,
  };
  applyAssistAlignment(state, spline);
  assert.ok(Math.abs(state.orientation?.yawDeg ?? 0) < 1e-9, "yaw alignment");
  assert.ok(Math.abs((state.orientation?.pitchDeg ?? 0) - 45) < 1e-9, "pitch alignment");
  assert.ok(Math.abs(state.orientation?.rollDeg ?? 0) < 1e-9, "roll alignment");
  assert.strictEqual(state.angularVelocity?.x, 0, "angular x dampened");
  assert.strictEqual(state.angularVelocity?.y, 0, "angular y dampened");
  assert.strictEqual(state.angularVelocity?.z, 0, "angular z dampened");
}

//4.- Validate velocity and rotation are clamped by the shared Skiff stats.
{
  const state: VehicleStateLike = {
    position: { x: 0, y: 0, z: 0 },
    velocity: {
      x: skiffStats.maxSpeedMps * 5,
      y: skiffStats.maxSpeedMps * 2,
      z: skiffStats.maxSpeedMps * 0.5,
    },
    orientation: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 },
    angularVelocity: {
      x: skiffStats.maxAngularSpeedDegPerSec * 4,
      y: skiffStats.maxAngularSpeedDegPerSec * 2,
      z: 0,
    },
  };
  integrateVehicle(state, 1, skiffStats);
  const velocity = state.velocity!;
  const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2);
  assert.ok(Math.abs(speed - skiffStats.maxSpeedMps) < 1e-6, "linear clamp should match Skiff cap");
  const displacementSq =
    (state.position?.x ?? 0) ** 2 + (state.position?.y ?? 0) ** 2 + (state.position?.z ?? 0) ** 2;
  assert.ok(Math.abs(displacementSq - skiffStats.maxSpeedMps ** 2) < 1e-4, "position delta reflects clamped speed");
  const angular = state.angularVelocity!;
  const angularSpeed = Math.sqrt(angular.x ** 2 + angular.y ** 2 + angular.z ** 2);
  assert.ok(
    Math.abs(angularSpeed - skiffStats.maxAngularSpeedDegPerSec) < 1e-6,
    "angular clamp should match Skiff cap",
  );
}

//5.- Loadout specific stats should influence the clamp thresholds on demand.
{
  const aggressiveStats = deriveStatsWithModifiers(skiffStats, {
    speedMultiplier: 1.2,
    agilityMultiplier: 0.5,
    damageMultiplier: 1.0,
    boostCooldownScale: 1.0,
  });
  const state: VehicleStateLike = {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: aggressiveStats.maxSpeedMps * 10, y: 0, z: 0 },
    orientation: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 },
    angularVelocity: { x: aggressiveStats.maxAngularSpeedDegPerSec * 4, y: 0, z: 0 },
  };
  integrateVehicle(state, 1, aggressiveStats);
  assert.ok(
    Math.abs(Math.sqrt(state.velocity!.x ** 2) - aggressiveStats.maxSpeedMps) < 1e-6,
    "custom stats should clamp linear speed",
  );
  assert.ok(
    Math.abs(Math.sqrt(state.angularVelocity!.x ** 2) - aggressiveStats.maxAngularSpeedDegPerSec) < 1e-6,
    "custom stats should clamp angular speed",
  );
}
