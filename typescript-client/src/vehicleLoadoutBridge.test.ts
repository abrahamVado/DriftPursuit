import assert from "node:assert";
import { groundVehiclePlaceholders } from "./gameplayConfig";
import {
  findLoadout,
  getDisabledVehicles,
  getSelectableVehicles,
  getVehicleLoadouts,
} from "./webLoadoutBridge";

//1.- Selectable helper should only return the Skiff while ground vehicles are placeholders.
const selectable = getSelectableVehicles();
assert.deepStrictEqual(
  selectable.map((option) => option.id),
  ["skiff"],
  "only the skiff should remain available",
);
assert.strictEqual(
  selectable[0]?.defaultLoadoutId,
  "skiff-strike",
  "strike should be the default loadout option",
);
assert.ok(selectable[0]?.loadouts.length && selectable[0]?.loadouts[0]?.icon, "loadouts should expose icons");

//2.- Disabled helper mirrors the placeholder roster to keep messaging aligned.
const disabledIds = getDisabledVehicles()
  .map((option) => option.id)
  .sort();
const placeholderIds = Object.keys(groundVehiclePlaceholders).sort();
assert.deepStrictEqual(disabledIds, placeholderIds, "ground vehicles must be disabled in the UI");

//3.- Loadout lookup helpers should surface metadata and respect disabled entries.
const skiffLoadouts = getVehicleLoadouts("skiff");
assert.ok(skiffLoadouts.length > 0, "skiff loadout list should not be empty");
const tankLoadout = findLoadout("skiff", "skiff-tank");
assert.strictEqual(tankLoadout?.selectable, false, "tank loadout should be flagged as disabled");
assert.ok(tankLoadout?.description.includes("Future"), "tank tooltip should flag future availability");
