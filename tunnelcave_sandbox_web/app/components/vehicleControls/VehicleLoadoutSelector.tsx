'use client'

import React, { useMemo } from 'react'

import {
  getSelectableVehicles,
  type LoadoutOption,
} from '../../../../typescript-client/src/webLoadoutBridge'

interface VehicleLoadoutSelectorProps {
  //1.- Provide the currently selected vehicle identifier so the UI stays controlled.
  vehicleId: string
  //2.- Track the current loadout identifier for the nested selector.
  loadoutId: string
  //3.- Emit vehicle selection changes to higher level components for persistence.
  onVehicleChange: (vehicleId: string) => void
  //4.- Emit loadout selection changes to higher level components for persistence.
  onLoadoutChange: (loadoutId: string) => void
}

const findDefaultLoadout = (option: LoadoutOption | undefined): string => {
  //1.- Prefer the configured default identifier when present, otherwise fall back to the first loadout.
  if (!option) {
    return ''
  }
  if (option.defaultLoadoutId) {
    return option.defaultLoadoutId
  }
  return option.loadouts[0]?.id ?? ''
}

export function VehicleLoadoutSelector({
  vehicleId,
  loadoutId,
  onVehicleChange,
  onLoadoutChange,
}: VehicleLoadoutSelectorProps) {
  //1.- Resolve the selectable vehicles once per render lifecycle to avoid recomputing arrays on every interaction.
  const selectableVehicles = useMemo(() => getSelectableVehicles(), [])
  //1.- Resolve the currently active vehicle by falling back to the first selectable entry.
  const resolvedVehicleId = vehicleId || selectableVehicles[0]?.id || ''
  const activeVehicle = selectableVehicles.find((entry) => entry.id === resolvedVehicleId)
  //2.- Mirror the default loadout when no persisted selection exists yet.
  const effectiveLoadoutId = loadoutId || findDefaultLoadout(activeVehicle)
  const loadoutOptions = activeVehicle?.loadouts ?? []

  return (
    <fieldset>
      <legend>Vehicle Loadout</legend>
      <label>
        Vehicle
        <select
          value={resolvedVehicleId}
          onChange={(event) => {
            const nextVehicle = event.target.value
            const nextActive = selectableVehicles.find((entry) => entry.id === nextVehicle)
            onVehicleChange(nextVehicle)
            const defaultLoadout = findDefaultLoadout(nextActive)
            onLoadoutChange(defaultLoadout)
          }}
        >
          {selectableVehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.displayName}
            </option>
          ))}
        </select>
      </label>
      <label>
        Loadout
        <select
          value={effectiveLoadoutId}
          onChange={(event) => onLoadoutChange(event.target.value)}
          disabled={loadoutOptions.length === 0}
        >
          {loadoutOptions.map((loadout) => (
            <option key={loadout.id} value={loadout.id}>
              {loadout.displayName}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  )
}

export default VehicleLoadoutSelector
