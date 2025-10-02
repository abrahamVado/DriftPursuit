import assert from "node:assert";
import { groundVehiclePlaceholders, skiffStats } from "./gameplayConfig";

//1.- Verify each stat so mismatches between client and server are immediately obvious.
assert.strictEqual(skiffStats.maxSpeedMps, 120.0, "max speed should match shared config");
assert.strictEqual(skiffStats.maxAngularSpeedDegPerSec, 180.0, "max angular speed should match shared config");
assert.strictEqual(skiffStats.forwardAccelerationMps2, 32.0, "forward acceleration should match shared config");
assert.strictEqual(skiffStats.reverseAccelerationMps2, 22.0, "reverse acceleration should match shared config");
assert.strictEqual(skiffStats.strafeAccelerationMps2, 18.0, "strafe acceleration should match shared config");
assert.strictEqual(skiffStats.verticalAccelerationMps2, 16.0, "vertical acceleration should match shared config");
assert.strictEqual(skiffStats.boostAccelerationMps2, 48.0, "boost acceleration should match shared config");
assert.strictEqual(skiffStats.boostDurationSeconds, 3.5, "boost duration should match shared config");
assert.strictEqual(skiffStats.boostCooldownSeconds, 9.0, "boost cooldown should match shared config");

//1.- Materialise the placeholder roster so the assertions stay deterministic.
const placeholderEntries = Object.entries(groundVehiclePlaceholders);
//2.- Ensure each placeholder stays non-selectable until the physics layer supports ground vehicles.
placeholderEntries.forEach(([identifier, config]) => {
  assert.strictEqual(config.selectable, false, `${identifier} should remain disabled in the roster`);
  assert.ok(config.notes.length > 0, `${identifier} placeholder must document why it is disabled`);
  assert.strictEqual(
    config.stats.maxSpeedMps,
    0,
    `${identifier} placeholder uses zero stats until gameplay data arrives`,
  );
});
