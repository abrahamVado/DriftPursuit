import { vehicleRoster, VehicleRosterEntry } from "../../../typescript-client/src/vehicleRoster";

export interface LoadoutOption {
  //1.- Provide the identifier for binding UI selection state.
  id: string;
  //2.- Human readable label surfaced to players.
  displayName: string;
  //3.- Snapshot of the underlying roster entry so tooltips can access metadata.
  reference: VehicleRosterEntry;
}

export function getSelectableVehicles(): LoadoutOption[] {
  //1.- Filter the roster so UI widgets only offer selectable entries.
  return vehicleRoster
    .filter((entry) => entry.selectable)
    .map((entry) => ({ id: entry.id, displayName: entry.displayName, reference: entry }));
}

export function getDisabledVehicles(): LoadoutOption[] {
  //1.- Surface disabled entries along with their metadata for tooltip messaging.
  return vehicleRoster
    .filter((entry) => !entry.selectable)
    .map((entry) => ({ id: entry.id, displayName: entry.displayName, reference: entry }));
}
