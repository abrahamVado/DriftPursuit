import { describe, expect, it } from 'vitest'
import { RadarPaletteController, RADAR_PALETTES } from './radarPalettes'

describe('RadarPaletteController', () => {
  it('applies the palette as custom properties on the document root', () => {
    //1.- Create a controller bound to the current document to validate CSS property updates.
    const controller = new RadarPaletteController(document)
    controller.apply('colorSafe')
    const root = document.documentElement
    expect(root.dataset.radarPalette).toBe('colorSafe')
    const palette = RADAR_PALETTES.find((entry) => entry.id === 'colorSafe')!
    expect(root.style.getPropertyValue('--radar-background')).toBe(palette.background)
    expect(root.style.getPropertyValue('--radar-friendly')).toBe(palette.friendly)
    expect(root.style.getPropertyValue('--radar-hostile')).toBe(palette.hostile)
    expect(root.style.getPropertyValue('--radar-neutral')).toBe(palette.neutral)
  })
})
