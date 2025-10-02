import { GroundVehicleConfig, groundVehiclePlaceholders, skiffStats, VehicleStats } from "./gameplayConfig";

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
}

function liftGroundPlaceholder(identifier: string, config: GroundVehicleConfig): VehicleRosterEntry {
  //1.- Convert the placeholder structure into the roster format expected by the UI.
  return Object.freeze({
    id: identifier,
    displayName: config.displayName,
    stats: config.stats,
    selectable: config.selectable,
    disabledReason: config.selectable ? undefined : config.notes,
  });
}

export const vehicleRoster: readonly VehicleRosterEntry[] = Object.freeze([
  Object.freeze({
    //1.- Skiff remains the sole selectable craft until ground vehicles are production ready.
    id: "skiff",
    displayName: "Skiff",
    stats: skiffStats,
    selectable: true,
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
