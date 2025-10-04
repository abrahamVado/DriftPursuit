import {
  groundVehiclePlaceholders,
  skiffLoadouts,
  skiffStats,
  deriveStatsWithModifiers,
} from "./gameplayConfig";
import type {
  GroundVehicleConfig,
  VehicleLoadoutConfig,
  VehicleStats,
} from "./gameplayConfig";

export interface VehicleLoadoutSummary {
  //1.- Stable identifier used when issuing spawn or respawn requests.
  id: string;
  //2.- Human readable label rendered in selection menus.
  displayName: string;
  //3.- Short description surfaced to help players pick a role.
  description: string;
  //4.- Icon path so the HUD can show a themed graphic.
  icon: string;
  //5.- Flag noting whether the loadout can be equipped right now.
  selectable: boolean;
  //6.- Weapon bundle exposed for tooltips and telemetry.
  weapons: VehicleLoadoutConfig["weapons"];
  //7.- Passive modifier snapshot reused by both physics and combat calculations.
  passiveModifiers: VehicleLoadoutConfig["passiveModifiers"];
  //8.- Derived vehicle stats after applying the passive modifiers.
  stats: VehicleStats;
}

export interface VehicleRosterEntry {
  //1.- Provide a stable identifier consumed by UI components and telemetry.
  id: string;
  //2.- Expose a human-friendly label for the selection widget.
  displayName: string;
  //3.- Carry the stats payload so previews can reflect the tuned numbers.
  stats: VehicleStats;
  //4.- Flag whether the entry is currently selectable by players.
  selectable: boolean;
  //5.- Explain why an entry is disabled so tooltips and logs remain informative.
  disabledReason?: string;
  //6.- Collection of loadout options with their derived stat blocks.
  loadouts: readonly VehicleLoadoutSummary[];
  //7.- Suggest a default loadout identifier for quick spawn flows.
  defaultLoadoutId?: string;
}

function liftGroundPlaceholder(identifier: string, config: GroundVehicleConfig): VehicleRosterEntry {
  //1.- Convert the placeholder structure into the roster format expected by the UI.
  return Object.freeze({
    id: identifier,
    displayName: config.displayName,
    stats: config.stats,
    selectable: config.selectable,
    disabledReason: config.selectable ? undefined : config.notes,
    loadouts: Object.freeze([]),
  });
}

function translateLoadout(config: VehicleLoadoutConfig): VehicleLoadoutSummary {
  //1.- Precompute the stat block so consumers avoid recomputing on every render.
  const stats = deriveStatsWithModifiers(skiffStats, config.passiveModifiers);
  return Object.freeze({
    id: config.id,
    displayName: config.displayName,
    description: config.description,
    icon: config.icon,
    selectable: config.selectable,
    weapons: config.weapons,
    passiveModifiers: config.passiveModifiers,
    stats,
  });
}

export const vehicleRoster: readonly VehicleRosterEntry[] = Object.freeze([
  Object.freeze({
    //1.- Skiff remains the sole selectable craft until ground vehicles are production ready.
    id: "skiff",
    displayName: "Skiff",
    stats: skiffStats,
    selectable: true,
    loadouts: Object.freeze(skiffLoadouts.map((entry) => translateLoadout(entry))),
    defaultLoadoutId: skiffLoadouts.find((entry) => entry.selectable)?.id,
  }),
  ...Object.entries(groundVehiclePlaceholders).map(([identifier, config]) =>
    liftGroundPlaceholder(identifier, config),
  ),
]);

export function isVehicleSelectable(identifier: string): boolean {
  //1.- Look up the roster entry and default to false when unknown identifiers appear.
  const entry = vehicleRoster.find((candidate) => candidate.id === identifier);
  return entry ? entry.selectable : false;
}
