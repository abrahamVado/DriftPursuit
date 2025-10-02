import assert from "node:assert";
import { VehicleState } from "./generated/vehicle";
import { Orientation, Vector3 } from "./generated/types";

const position: Vector3 = { x: 1, y: 2, z: 3 };
const velocity: Vector3 = { x: 4, y: 5, z: 6 };
const angular: Vector3 = { x: 0.1, y: 0.2, z: 0.3 };
const orientation: Orientation = { yawDeg: 10, pitchDeg: 5, rollDeg: 1 };

const sample: VehicleState = {
  schemaVersion: "0.2.0",
  vehicleId: "veh-001",
  position,
  velocity,
  orientation,
  angularVelocity: angular,
  speedMps: 123.4,
  throttlePct: 0.5,
  verticalThrustPct: -0.25,
  boostPct: 0.9,
  boostActive: true,
  flightAssistEnabled: true,
  energyRemainingPct: 0.75,
  updatedAtMs: 123456789,
};

const encoded = VehicleState.encode(sample).finish();
const decoded = VehicleState.decode(encoded);

assert.deepStrictEqual(decoded, sample, "decoded state should match the input payload");

const json = VehicleState.toJSON(decoded) as Record<string, unknown>;
assert.strictEqual(json["vehicleId"], sample.vehicleId, "vehicle id should survive JSON conversion");

const restored = VehicleState.fromJSON(json);
assert.deepStrictEqual(restored, sample, "JSON round trip should preserve values");
