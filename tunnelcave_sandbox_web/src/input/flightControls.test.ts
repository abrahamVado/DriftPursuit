import { describe, expect, it } from 'vitest'

import {
  DEFAULT_FLIGHT_BINDINGS,
  FlightKeybindingConfiguration,
  createFlightKeybindingConfiguration,
} from './flightControls'

//1.- Validate the War Thunder inspired defaults map actions to the expected keys and axes.
describe('FlightKeybindingConfiguration defaults', () => {
  it('exposes the full default control layout', () => {
    const config = createFlightKeybindingConfiguration()
    const bindings = config.describe()
    for (const definition of DEFAULT_FLIGHT_BINDINGS) {
      const binding = bindings.find((entry) => entry.action === definition.action)
      expect(binding?.axis).toBe(definition.axis)
      expect(binding?.mode).toBe(definition.mode)
      expect(binding?.key).toBe(definition.defaultKey)
      expect(binding?.step).toBe(definition.step)
    }
  })
})

//2.- Confirm overrides flow through accessibility helpers without mutating the defaults.
describe('FlightKeybindingConfiguration overrides', () => {
  it('allows throttle adjustments to use alternate keys', () => {
    const config = FlightKeybindingConfiguration.withDefaults({
      'Throttle Increase': { key: 'KeyR' },
      'Throttle Decrease': { key: 'KeyF' },
    })
    const increase = config.describe().find((entry) => entry.action === 'Throttle Increase')
    const defaults = config.listDefaults().find((entry) => entry.action === 'Throttle Increase')
    expect(increase?.key).toBe('KeyR')
    expect(defaults?.key).toBe('ShiftLeft')
  })

  it('surfaces accessibility summaries pairing current and default bindings', () => {
    const config = FlightKeybindingConfiguration.withDefaults({ 'Toggle Freelook': { key: 'Mouse3' } })
    const summary = config.accessibilitySummaries().find((entry) => entry.action === 'Toggle Freelook')
    expect(summary).toEqual({ action: 'Toggle Freelook', key: 'Mouse3', defaultKey: 'KeyC' })
  })
})
