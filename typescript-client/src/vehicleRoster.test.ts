import assert from "node:assert";
import { groundVehiclePlaceholders } from "./gameplayConfig";
import { isVehicleSelectable, vehicleRoster } from "./vehicleRoster";

//1.- Confirm the Skiff remains selectable for players.
const skiffEntry = vehicleRoster.find((entry) => entry.id === "skiff");
assert.ok(skiffEntry, "skiff entry should exist");
assert.strictEqual(skiffEntry?.selectable, true, "skiff should be selectable");

//2.- Validate that every ground placeholder is exposed but remains disabled.
Object.keys(groundVehiclePlaceholders).forEach((identifier) => {
  const entry = vehicleRoster.find((candidate) => candidate.id === identifier);
  assert.ok(entry, `${identifier} placeholder should appear in the roster`);
  assert.strictEqual(entry?.selectable, false, `${identifier} should not be selectable`);
  assert.strictEqual(
    isVehicleSelectable(identifier),
    false,
    `${identifier} helper should report non-selectable status`,
  );
});

//3.- Unknown identifiers should also be rejected by the helper for safety.
assert.strictEqual(isVehicleSelectable("unknown"), false, "unknown vehicles must be rejected");
