import assert from "node:assert";
import {
  deriveStatsWithModifiers,
  clampDamageMultiplier,
  getSkiffLoadoutDamageMultiplier,
  getSkiffLoadoutStats,
  groundVehiclePlaceholders,
  skiffLoadouts,
  skiffStats,
} from "./gameplayConfig";

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

//1.- Confirm the skiff loadout catalog contains the expected selectable entries.
const selectableLoadouts = skiffLoadouts.filter((entry) => entry.selectable);
assert.deepStrictEqual(
  selectableLoadouts.map((entry) => entry.id),
  ["skiff-strike", "skiff-raider"],
  "only strike and raider should be selectable",
);

//2.- Verify the disabled loadout communicates the future roadmap to the UI layer.
const tankLoadout = skiffLoadouts.find((entry) => entry.id === "skiff-tank");
assert.ok(tankLoadout, "tank loadout should exist in the catalog");
assert.strictEqual(tankLoadout?.selectable, false, "tank loadout should be disabled until ready");
assert.ok(tankLoadout?.description.includes("Future"), "tank description should flag the future status");

//3.- Ensure stat derivation honours each passive modifier channel.
const boostedStats = deriveStatsWithModifiers(skiffStats, {
  speedMultiplier: 1.1,
  agilityMultiplier: 0.9,
  damageMultiplier: 1.25,
  boostCooldownScale: 0.8,
});
assert.ok(boostedStats.maxSpeedMps > skiffStats.maxSpeedMps, "speed multiplier should scale forward velocity");
assert.ok(
  boostedStats.forwardAccelerationMps2 < skiffStats.forwardAccelerationMps2,
  "agility multiplier under 1 should reduce acceleration",
);
assert.ok(
  boostedStats.boostCooldownSeconds < skiffStats.boostCooldownSeconds,
  "cooldown scale under 1 should shorten boost cooldown",
);

//4.- Loadout helpers must return consistent stat snapshots and damage multipliers.
const raiderStats = getSkiffLoadoutStats("skiff-raider");
assert.ok(raiderStats.maxSpeedMps > skiffStats.maxSpeedMps, "raider should increase top speed");
assert.strictEqual(
  getSkiffLoadoutDamageMultiplier("skiff-raider"),
  0.9,
  "raider damage multiplier should reflect configuration",
);
assert.strictEqual(
  getSkiffLoadoutDamageMultiplier("unknown"),
  1,
  "unknown loadout should keep damage neutral",
);

//5.- Clamp helper should mirror the server behaviour for invalid multipliers.
assert.strictEqual(clampDamageMultiplier(0), 1, "zero multiplier should clamp to neutral");
assert.strictEqual(clampDamageMultiplier(-2), 1, "negative multiplier should clamp to neutral");
assert.strictEqual(clampDamageMultiplier(1.5), 1.5, "positive multiplier should remain unchanged");
