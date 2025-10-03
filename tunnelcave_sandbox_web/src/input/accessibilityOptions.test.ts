import { describe, expect, it } from 'vitest'
import {
  AccessibilityOptions,
  DEFAULT_ACCESSIBILITY_TOGGLES,
} from './accessibilityOptions'

describe('AccessibilityOptions', () => {
  it('exposes summaries that include default bindings', () => {
    //1.- Instantiate with defaults so the summary should mirror the baked in layout.
    const options = new AccessibilityOptions()
    const accelerator = options
      .summaries()
      .find((summary) => summary.action === 'Accelerate')
    expect(accelerator).toEqual({ action: 'Accelerate', key: 'KeyW', defaultKey: 'KeyW' })
  })

  it('applies overrides while retaining the original defaults in summaries', () => {
    //1.- Apply a throttle override and ensure the summary tracks both keys.
    const options = new AccessibilityOptions()
    options.apply({ Accelerate: { key: 'ArrowUp' } })
    const accelerator = options
      .summaries()
      .find((summary) => summary.action === 'Accelerate')
    expect(accelerator).toEqual({ action: 'Accelerate', key: 'ArrowUp', defaultKey: 'KeyW' })
    //2.- The current configuration should now resolve the override when queried.
    const binding = options.currentConfiguration().findByKey('ArrowUp')
    expect(binding?.action).toBe('Accelerate')
  })

  it('tracks toggle state and merges incremental updates', () => {
    //1.- Start with the default toggle state to verify the cloning behaviour.
    const options = new AccessibilityOptions()
    expect(options.toggleState()).toEqual(DEFAULT_ACCESSIBILITY_TOGGLES)
    //2.- Apply a single reduced-motion override while leaving the palette intact.
    options.applyToggles({ reducedMotion: true })
    expect(options.toggleState()).toEqual({ radarPalette: 'classic', reducedMotion: true })
    //3.- Switching palettes should retain the previously toggled reduced-motion flag.
    options.applyToggles({ radarPalette: 'colorSafe' })
    expect(options.toggleState()).toEqual({ radarPalette: 'colorSafe', reducedMotion: true })
  })
})
