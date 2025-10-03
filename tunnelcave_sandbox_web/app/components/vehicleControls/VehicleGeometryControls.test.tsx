import '@testing-library/jest-dom'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { VehicleGeometryControls, type VehicleGeometrySettings } from './VehicleGeometryControls'

const DEFAULT_SETTINGS: VehicleGeometrySettings = {
  //1.- Provide deterministic defaults mirroring the component's base state.
  wheelbase: 2.6,
  trackWidth: 1.8,
  centerOfMassHeight: 0.85,
  steeringInverted: false,
}

describe('VehicleGeometryControls', () => {
  it('renders geometry sliders with formatted values', () => {
    render(<VehicleGeometryControls value={DEFAULT_SETTINGS} onChange={() => {}} />)

    expect(screen.getByLabelText(/Wheelbase/)).toHaveValue(DEFAULT_SETTINGS.wheelbase.toString())
    expect(screen.getByLabelText(/Track Width/)).toHaveValue(DEFAULT_SETTINGS.trackWidth.toString())
    expect(screen.getByLabelText(/Center of Mass Height/)).toHaveValue(
      DEFAULT_SETTINGS.centerOfMassHeight.toString(),
    )
    expect(screen.getByLabelText(/Invert Steering/)).not.toBeChecked()
  })

  it('invokes the onChange callback when sliders are adjusted', () => {
    const handleChange = vi.fn()
    render(<VehicleGeometryControls value={DEFAULT_SETTINGS} onChange={handleChange} />)

    fireEvent.change(screen.getByLabelText(/Wheelbase/), { target: { value: '3.1' } })
    expect(handleChange).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, wheelbase: 3.1 })

    fireEvent.click(screen.getByLabelText(/Invert Steering/))
    expect(handleChange).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, steeringInverted: true })
  })
})
