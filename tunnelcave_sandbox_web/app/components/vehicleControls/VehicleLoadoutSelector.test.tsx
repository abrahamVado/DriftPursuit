import '@testing-library/jest-dom'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { VehicleLoadoutSelector } from './VehicleLoadoutSelector'
import { getSelectableVehicles } from '../@client/webLoadoutBridge'

describe('VehicleLoadoutSelector', () => {
  it('renders vehicle and loadout options from the roster', () => {
    const selectable = getSelectableVehicles()
    const firstVehicle = selectable[0]

    render(
      <VehicleLoadoutSelector
        vehicleId=""
        loadoutId=""
        onVehicleChange={() => {}}
        onLoadoutChange={() => {}}
      />,
    )

    expect(screen.getByLabelText('Vehicle')).toHaveDisplayValue(firstVehicle.displayName)
    if (firstVehicle.loadouts.length > 0) {
      expect(screen.getByLabelText('Loadout')).toHaveDisplayValue(firstVehicle.loadouts[0]?.displayName ?? '')
    }
  })

  it('emits callbacks when the user changes selections', () => {
    const selectable = getSelectableVehicles()
    const firstVehicle = selectable[0]
    const loadout = firstVehicle.loadouts[0]

    const handleVehicleChange = vi.fn()
    const handleLoadoutChange = vi.fn()

    render(
      <VehicleLoadoutSelector
        vehicleId={firstVehicle.id}
        loadoutId={loadout?.id ?? ''}
        onVehicleChange={handleVehicleChange}
        onLoadoutChange={handleLoadoutChange}
      />,
    )

    fireEvent.change(screen.getByLabelText('Vehicle'), { target: { value: firstVehicle.id } })
    expect(handleVehicleChange).toHaveBeenCalledWith(firstVehicle.id)

    if (loadout) {
      fireEvent.change(screen.getByLabelText('Loadout'), { target: { value: loadout.id } })
      expect(handleLoadoutChange).toHaveBeenCalledWith(loadout.id)
    }
  })
})
