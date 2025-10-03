import {
  AccessibilityOptions,
  AccessibilityToggleState,
} from '../../input/accessibilityOptions'
import { RADAR_PALETTES, RadarPaletteController } from '../../hud/radarPalettes'
import { AccessibilityPreferenceStore } from './accessibilityPreferenceStore'

export class AccessibilityTogglesMenu {
  private readonly container: HTMLElement
  private readonly options: AccessibilityOptions
  private readonly store: AccessibilityPreferenceStore
  private readonly radarPalettes: RadarPaletteController
  private readonly ownerDocument: Document

  constructor(
    root: HTMLElement,
    options: AccessibilityOptions,
    store: AccessibilityPreferenceStore,
    radarPalettes: RadarPaletteController,
    ownerDocument: Document = document,
  ) {
    //1.- Persist collaborators to keep the UI in sync with gameplay systems and storage.
    this.options = options
    this.store = store
    this.radarPalettes = radarPalettes
    this.ownerDocument = ownerDocument
    //2.- Hydrate the toggle state from storage before rendering UI controls.
    const toggles = this.store.toggleState()
    this.options.applyToggles(toggles)
    this.applyVisuals(toggles)
    //3.- Build the settings section so players can adjust the toggles interactively.
    this.container = ownerDocument.createElement('section')
    this.container.className = 'accessibility-toggles'
    const heading = ownerDocument.createElement('h3')
    heading.textContent = 'Accessibility Preferences'
    this.container.append(heading)
    this.render(toggles)
    root.append(this.container)
  }

  private render(state: AccessibilityToggleState): void {
    //1.- Render the radar palette selector list.
    const paletteLabel = this.ownerDocument.createElement('label')
    paletteLabel.textContent = 'Radar Palette'
    const paletteSelect = this.ownerDocument.createElement('select')
    paletteSelect.className = 'accessibility-toggles__palette'
    for (const palette of RADAR_PALETTES) {
      const option = this.ownerDocument.createElement('option')
      option.value = palette.id
      option.textContent = palette.label
      if (palette.id === state.radarPalette) {
        option.selected = true
      }
      paletteSelect.append(option)
    }
    paletteSelect.addEventListener('change', () => {
      const next = { ...this.options.toggleState(), radarPalette: paletteSelect.value as typeof state.radarPalette }
      this.commitToggleState(next)
    })
    const paletteWrapper = this.ownerDocument.createElement('div')
    paletteWrapper.className = 'accessibility-toggles__row'
    paletteWrapper.append(paletteLabel, paletteSelect)

    //2.- Render the reduced motion checkbox so UI elements can tone down animation.
    const reducedMotionWrapper = this.ownerDocument.createElement('div')
    reducedMotionWrapper.className = 'accessibility-toggles__row'
    const reducedMotionLabel = this.ownerDocument.createElement('label')
    reducedMotionLabel.textContent = 'Reduced Motion'
    const reducedMotionCheckbox = this.ownerDocument.createElement('input')
    reducedMotionCheckbox.type = 'checkbox'
    reducedMotionCheckbox.checked = state.reducedMotion
    reducedMotionCheckbox.addEventListener('change', () => {
      const next = { ...this.options.toggleState(), reducedMotion: reducedMotionCheckbox.checked }
      this.commitToggleState(next)
    })
    reducedMotionWrapper.append(reducedMotionLabel, reducedMotionCheckbox)

    const list = this.ownerDocument.createElement('div')
    list.className = 'accessibility-toggles__list'
    list.append(paletteWrapper, reducedMotionWrapper)

    const existing = this.container.querySelector('.accessibility-toggles__list')
    if (existing) {
      existing.replaceWith(list)
    } else {
      this.container.append(list)
    }
  }

  private commitToggleState(state: AccessibilityToggleState): void {
    //1.- Persist the toggles locally and push them into the gameplay options.
    this.options.applyToggles(state)
    this.store.saveToggles(state)
    this.applyVisuals(state)
  }

  private applyVisuals(state: AccessibilityToggleState): void {
    //1.- Apply the selected radar palette so the HUD updates instantly.
    this.radarPalettes.apply(state.radarPalette)
    //2.- Reflect the reduced motion preference for CSS animations to observe.
    const root = this.ownerDocument.documentElement
    root.dataset.reducedMotion = state.reducedMotion ? 'true' : 'false'
  }
}
