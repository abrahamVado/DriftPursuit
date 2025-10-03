import '@testing-library/jest-dom'
import React from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { VehicleControlSettings } from './VehicleControlSettings'
import { getSelectableVehicles } from '../../../../typescript-client/src/webLoadoutBridge'

describe('VehicleControlSettings', () => {
  beforeEach(() => {
    //1.- Reset storage to ensure persistence tests operate deterministically.
    window.localStorage.clear()
  })

  it('lists the default keybindings for reference', () => {
    render(<VehicleControlSettings />)

    expect(screen.getByRole('heading', { name: 'Keybindings' })).toBeInTheDocument()
    expect(screen.getByText(/Accelerate/)).toBeInTheDocument()
    expect(screen.getByText(/KeyW/)).toBeInTheDocument()
  })

  it('persists geometry adjustments to local storage', async () => {
    render(<VehicleControlSettings />)

    fireEvent.change(screen.getByLabelText(/Wheelbase/), { target: { value: '3.2' } })

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem('vehicle-geometry-settings') ?? '{}')
      expect(stored.wheelbase).toBeCloseTo(3.2)
    })
  })

  it('derives default loadout selections from the roster', async () => {
    const selectable = getSelectableVehicles()
    const expectedVehicle = selectable[0]?.id ?? ''
    const expectedLoadout = selectable[0]?.defaultLoadoutId ?? selectable[0]?.loadouts[0]?.id ?? ''

    render(<VehicleControlSettings />)

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem('vehicle-loadout-selection') ?? '{}')
      expect(stored.vehicleId).toBe(expectedVehicle)
      expect(stored.loadoutId).toBe(expectedLoadout)
    })
  })
})
