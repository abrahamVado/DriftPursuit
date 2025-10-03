'use client'

import React from 'react'

export interface VehicleGeometrySettings {
  //1.- Capture the wheelbase in meters so sliders can expose chassis length adjustments.
  wheelbase: number
  //2.- Track the track width in meters to mirror lateral stance adjustments.
  trackWidth: number
  //3.- Persist the center of mass height in meters to influence handling.
  centerOfMassHeight: number
  //4.- Store whether steering inputs should be inverted for accessibility.
  steeringInverted: boolean
}

interface VehicleGeometryControlsProps {
  //1.- Receive the current geometry settings so the sliders reflect persisted values.
  value: VehicleGeometrySettings
  //2.- Notify listeners whenever a slider or toggle updates a geometry parameter.
  onChange: (next: VehicleGeometrySettings) => void
}

const clamp = (value: number, min: number, max: number): number => {
  //1.- Constrain slider derived values inside their configured range.
  return Math.min(Math.max(value, min), max)
}

const NUMERIC_BOUNDS: Record<Exclude<keyof VehicleGeometrySettings, 'steeringInverted'>, {
  min: number
  max: number
}> = {
  //1.- Wheelbase slider spans from a compact 1.5m chassis to a stretched 4.5m platform.
  wheelbase: { min: 1.5, max: 4.5 },
  //2.- Track width slider covers nimble skiffs through wider tanks.
  trackWidth: { min: 1.2, max: 3.5 },
  //3.- Center of mass slider ranges from 0.2m (low slung) to 2.5m (towering rigs).
  centerOfMassHeight: { min: 0.2, max: 2.5 },
}

export function VehicleGeometryControls({ value, onChange }: VehicleGeometryControlsProps) {
  //1.- Build change helpers so each slider updates a single field without recreating objects manually.
  const updateField = (key: keyof VehicleGeometrySettings, raw: number | boolean) => {
    if (typeof raw === 'number') {
      const bounds = NUMERIC_BOUNDS[key as keyof typeof NUMERIC_BOUNDS]
      const nextNumber = bounds ? clamp(raw, bounds.min, bounds.max) : raw
      onChange({ ...value, [key]: nextNumber })
      return
    }
    onChange({ ...value, [key]: raw })
  }

  return (
    <fieldset>
      <legend>Vehicle Geometry</legend>
      <label>
        Wheelbase ({value.wheelbase.toFixed(2)} m)
        <input
          type="range"
          min={1.5}
          max={4.5}
          step={0.1}
          value={value.wheelbase}
          onChange={(event) => updateField('wheelbase', Number.parseFloat(event.target.value))}
        />
      </label>
      <label>
        Track Width ({value.trackWidth.toFixed(2)} m)
        <input
          type="range"
          min={1.2}
          max={3.5}
          step={0.1}
          value={value.trackWidth}
          onChange={(event) => updateField('trackWidth', Number.parseFloat(event.target.value))}
        />
      </label>
      <label>
        Center of Mass Height ({value.centerOfMassHeight.toFixed(2)} m)
        <input
          type="range"
          min={0.2}
          max={2.5}
          step={0.05}
          value={value.centerOfMassHeight}
          onChange={(event) => updateField('centerOfMassHeight', Number.parseFloat(event.target.value))}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.steeringInverted}
          onChange={(event) => updateField('steeringInverted', event.target.checked)}
        />
        Invert Steering
      </label>
    </fieldset>
  )
}

export default VehicleGeometryControls
