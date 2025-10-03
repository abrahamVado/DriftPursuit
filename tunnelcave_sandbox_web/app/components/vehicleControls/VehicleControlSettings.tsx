'use client'

import React, { useEffect, useMemo } from 'react'

import VehicleGeometryControls, {
  type VehicleGeometrySettings,
} from './VehicleGeometryControls'
import VehicleLoadoutSelector from './VehicleLoadoutSelector'
import { usePersistentSetting } from '../../../src/ui/settings/usePersistentSetting'
import { KeybindingConfiguration } from '../../../src/input/keybindings'
import { getSelectableVehicles } from '../../../../typescript-client/src/webLoadoutBridge'

interface VehicleLoadoutSelection {
  //1.- Track the selected vehicle identifier so spawns remain deterministic across reloads.
  vehicleId: string
  //2.- Persist the selected loadout identifier for convenience when revisiting the panel.
  loadoutId: string
}

const DEFAULT_GEOMETRY: VehicleGeometrySettings = {
  //1.- Choose chassis defaults that map to the stock skiff configuration.
  wheelbase: 2.6,
  //2.- Default the track width to a balanced stance.
  trackWidth: 1.8,
  //3.- Set the center of mass height to the tuned mid-point for stability.
  centerOfMassHeight: 0.85,
  //4.- Disable inverted steering by default so controls match the keybinding descriptions.
  steeringInverted: false,
}

const DEFAULT_LOADOUT_SELECTION: VehicleLoadoutSelection = {
  //1.- Use the first selectable vehicle until the roster expands.
  vehicleId: '',
  //2.- Defer the loadout to be resolved once the vehicle is known.
  loadoutId: '',
}

export function VehicleControlSettings() {
  //1.- Persist geometry selections so tuning survives page reloads.
  const [geometry, setGeometry] = usePersistentSetting<VehicleGeometrySettings>(
    'vehicle-geometry-settings',
    DEFAULT_GEOMETRY,
  )
  //2.- Persist loadout selections to avoid forcing players to reselect their preferred kit.
  const [selection, setSelection] = usePersistentSetting<VehicleLoadoutSelection>(
    'vehicle-loadout-selection',
    DEFAULT_LOADOUT_SELECTION,
  )
  //3.- Cache the selectable roster entries to derive default selections and preview metadata.
  const selectableVehicles = useMemo(() => getSelectableVehicles(), [])

  const resolvedVehicleId = selection.vehicleId || selectableVehicles[0]?.id || ''
  const resolvedLoadoutId = useMemo(() => {
    const entry = selectableVehicles.find((candidate) => candidate.id === resolvedVehicleId)
    const preferredLoadout = selection.loadoutId || entry?.defaultLoadoutId || entry?.loadouts[0]?.id || ''
    return preferredLoadout
  }, [resolvedVehicleId, selectableVehicles, selection.loadoutId])

  useEffect(() => {
    //1.- Normalize persisted state so freshly initialized stores adopt the derived defaults.
    if (selection.vehicleId !== resolvedVehicleId || selection.loadoutId !== resolvedLoadoutId) {
      setSelection({ vehicleId: resolvedVehicleId, loadoutId: resolvedLoadoutId })
    }
  }, [resolvedLoadoutId, resolvedVehicleId, selection.loadoutId, selection.vehicleId, setSelection])

  //4.- Precompute the described keybindings so the list renders deterministically.
  const bindings = useMemo(
    () => KeybindingConfiguration.withDefaults().describe(),
    [],
  )

  return (
    <section aria-label="Vehicle control settings">
      <VehicleGeometryControls value={geometry} onChange={setGeometry} />
      <VehicleLoadoutSelector
        vehicleId={resolvedVehicleId}
        loadoutId={resolvedLoadoutId}
        onVehicleChange={(vehicleId) =>
          setSelection((current) => ({ ...current, vehicleId, loadoutId: '' }))
        }
        onLoadoutChange={(loadoutId) => setSelection((current) => ({ ...current, loadoutId }))}
      />
      <section aria-label="Keybinding summary">
        <h3>Keybindings</h3>
        <ul>
          {bindings.map((binding) => (
            <li key={binding.action}>
              <strong>{binding.action}</strong>: {binding.key}
            </li>
          ))}
        </ul>
      </section>
    </section>
  )
}

export default VehicleControlSettings
