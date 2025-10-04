
import { vehicleRoster } from "./vehicleRoster";
import type { VehicleLoadoutSummary, VehicleRosterEntry } from "./vehicleRoster";
export interface LoadoutOption {
  //1.- Provide the identifier for binding UI selection state.
  id: string;
  //2.- Human readable label surfaced to players.
  displayName: string;
  //3.- Snapshot of the underlying roster entry so tooltips can access metadata.
  reference: VehicleRosterEntry;
  //4.- Enumerate the loadouts so the UI can show role specific details.
  loadouts: readonly VehicleLoadoutSummary[];
  //5.- Track the default selection to simplify quick spawn workflows.
  defaultLoadoutId?: string;
}

export function getSelectableVehicles(): LoadoutOption[] {
  //1.- Filter the roster so UI widgets only offer selectable entries.
  return vehicleRoster
    .filter((entry) => entry.selectable)
    .map((entry) => ({
      id: entry.id,
      displayName: entry.displayName,
      reference: entry,
      loadouts: entry.loadouts,
      defaultLoadoutId: entry.defaultLoadoutId,
    }));
}

export function getDisabledVehicles(): LoadoutOption[] {
  //1.- Surface disabled entries along with their metadata for tooltip messaging.
  return vehicleRoster
    .filter((entry) => !entry.selectable)
    .map((entry) => ({
      id: entry.id,
      displayName: entry.displayName,
      reference: entry,
      loadouts: entry.loadouts,
      defaultLoadoutId: entry.defaultLoadoutId,
    }));
}

export function getVehicleLoadouts(vehicleId: string): readonly VehicleLoadoutSummary[] {
  //1.- Look up the roster entry and fall back to an empty list when unknown ids appear.
  const entry = vehicleRoster.find((candidate) => candidate.id === vehicleId);
  return entry ? entry.loadouts : [];
}

export function findLoadout(
  vehicleId: string,
  loadoutId: string,
): VehicleLoadoutSummary | undefined {
  //1.- Reuse the helper so selection widgets can fetch a concrete loadout descriptor.
  return getVehicleLoadouts(vehicleId).find((loadout) => loadout.id === loadoutId);
}
