import { describe, expect, it } from 'vitest'
import {
  KeybindingConfiguration,
  createKeybindingConfiguration,
  DEFAULT_BINDING_DEFINITIONS,
} from './keybindings'

describe('KeybindingConfiguration', () => {
  it('maps default keys to the expected control axes', () => {
    //1.- Create a configuration using the baked in defaults.
    const config = createKeybindingConfiguration()
    const bindings = config.describe()
    //2.- Every default definition should be represented in the runtime table.
    for (const definition of DEFAULT_BINDING_DEFINITIONS) {
      const binding = bindings.find((entry) => entry.action === definition.action)
      expect(binding?.axis).toBe(definition.axis)
      expect(binding?.mode).toBe(definition.mode)
      expect(binding?.key).toBe(definition.defaultKey)
    }
  })

  it('supports rebinding keys while keeping defaults available', () => {
    //1.- Assign a new accelerator key and keep the defaults for reference.
    const config = KeybindingConfiguration.withDefaults({
      Accelerate: { key: 'ArrowUp' },
    })
    const overridden = config.describe().find((entry) => entry.action === 'Accelerate')
    const defaults = config.listDefaults().find((entry) => entry.action === 'Accelerate')
    //2.- Confirm the override is active without mutating the default listing.
    expect(overridden?.key).toBe('ArrowUp')
    expect(defaults?.key).toBe('KeyW')
  })

  it('provides accessibility summaries pairing current and default keys', () => {
    //1.- Rebind steering controls to arrow keys for accessibility testing.
    const config = KeybindingConfiguration.withDefaults({
      'Steer Left': { key: 'ArrowLeft' },
      'Steer Right': { key: 'ArrowRight' },
    })
    const summaries = config.accessibilitySummaries()
    //2.- Ensure the summaries expose both the active and default key codes.
    const left = summaries.find((entry) => entry.action === 'Steer Left')
    const right = summaries.find((entry) => entry.action === 'Steer Right')
    expect(left).toEqual({ action: 'Steer Left', key: 'ArrowLeft', defaultKey: 'KeyA' })
    expect(right).toEqual({ action: 'Steer Right', key: 'ArrowRight', defaultKey: 'KeyD' })
  })
})
