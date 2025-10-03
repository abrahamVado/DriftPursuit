import { RadarPaletteId } from '../input/accessibilityOptions'

export interface RadarPaletteDefinition {
  //1.- Stable identifier persisted in settings and reflected in data attributes.
  id: RadarPaletteId
  //2.- Human readable label surfaced inside accessibility menus.
  label: string
  //3.- Background fill colour used by the radar sweep canvas.
  background: string
  //4.- Contact colour for friendly actors.
  friendly: string
  //5.- Contact colour for hostile actors.
  hostile: string
  //6.- Colour used for neutral or unknown contacts.
  neutral: string
}

export const RADAR_PALETTES: RadarPaletteDefinition[] = [
  {
    id: 'classic',
    label: 'Classic High Contrast',
    background: '#08111f',
    friendly: '#67fdd0',
    hostile: '#ff4f6d',
    neutral: '#f5f7ff',
  },
  {
    id: 'colorSafe',
    label: 'Colour-Safe (Deuteranopia)',
    background: '#0c1320',
    friendly: '#2dd6f7',
    hostile: '#ffd166',
    neutral: '#f2f4f8',
  },
]

export class RadarPaletteController {
  private readonly target: Document | ShadowRoot

  constructor(target: Document | ShadowRoot = document) {
    //1.- Keep a reference to the DOM scope that should receive the palette styling.
    this.target = target
  }

  apply(paletteId: RadarPaletteId): void {
    //1.- Resolve the palette definition, defaulting to the classic theme when unknown.
    const palette = RADAR_PALETTES.find((entry) => entry.id === paletteId) ?? RADAR_PALETTES[0]
    const root = this.resolveRootElement()
    if (!root) {
      return
    }
    //2.- Expose the palette identifier for CSS selectors and analytics.
    root.dataset.radarPalette = palette.id
    //3.- Set custom properties so canvas renderers and CSS can consume the palette.
    root.style.setProperty('--radar-background', palette.background)
    root.style.setProperty('--radar-friendly', palette.friendly)
    root.style.setProperty('--radar-hostile', palette.hostile)
    root.style.setProperty('--radar-neutral', palette.neutral)
  }

  private resolveRootElement(): HTMLElement | null {
    //1.- Support both top-level documents and shadow roots when applying the palette.
    if ('documentElement' in this.target && this.target.documentElement) {
      return this.target.documentElement
    }
    if ('host' in this.target && this.target.host instanceof HTMLElement) {
      return this.target.host
    }
    return null
  }
}
