import assert from "node:assert";
import { groundVehiclePlaceholders } from "./gameplayConfig";
import { getDisabledVehicles, getSelectableVehicles } from "../../tunnelcave_sandbox_web/src/world/vehicleLoadout";

//1.- Selectable helper should only return the Skiff while ground vehicles are placeholders.
const selectable = getSelectableVehicles();
assert.deepStrictEqual(
  selectable.map((option) => option.id),
  ["skiff"],
  "only the skiff should remain available",
);

//2.- Disabled helper mirrors the placeholder roster to keep messaging aligned.
const disabledIds = getDisabledVehicles()
  .map((option) => option.id)
  .sort();
const placeholderIds = Object.keys(groundVehiclePlaceholders).sort();
assert.deepStrictEqual(disabledIds, placeholderIds, "ground vehicles must be disabled in the UI");
