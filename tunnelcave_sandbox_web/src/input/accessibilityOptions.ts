import {
  AccessibilitySummary,
  KeybindingConfiguration,
  KeybindingOverrides,
  createKeybindingConfiguration,
} from './keybindings'

export type RadarPaletteId = 'classic' | 'colorSafe'

export interface AccessibilityToggleState {
  //1.- Track the selected radar palette so HUD systems can adjust their themes.
  radarPalette: RadarPaletteId
  //2.- Flag whether motion-heavy elements should tone down their animation cadence.
  reducedMotion: boolean
}

export const DEFAULT_ACCESSIBILITY_TOGGLES: AccessibilityToggleState = {
  //1.- Default to the high-contrast classic palette until the player opts into the colour-safe variant.
  radarPalette: 'classic',
  //2.- Assume standard motion until the user expresses a preference for calmer effects.
  reducedMotion: false,
}

export class AccessibilityOptions {
  private config: KeybindingConfiguration
  private toggles: AccessibilityToggleState

  constructor(
    config: KeybindingConfiguration = createKeybindingConfiguration(),
    toggles: AccessibilityToggleState = DEFAULT_ACCESSIBILITY_TOGGLES,
  ) {
    //1.- Retain a mutable configuration that can be reissued when overrides are applied.
    this.config = config
    //2.- Persist the current accessibility toggles so multiple menus stay in sync.
    this.toggles = { ...toggles }
  }

  summaries(): AccessibilitySummary[] {
    //1.- Surface the pairing of active and default keys for settings menus.
    return this.config.accessibilitySummaries()
  }

  apply(overrides: KeybindingOverrides): void {
    //1.- Rebuild the configuration so the new bindings take effect immediately.
    this.config = this.config.withOverrides(overrides)
  }

  currentConfiguration(): KeybindingConfiguration {
    //1.- Expose the latest keybinding table for other systems such as overlays.
    return this.config
  }

  toggleState(): AccessibilityToggleState {
    //1.- Provide a defensive copy so callers cannot mutate internal state accidentally.
    return { ...this.toggles }
  }

  applyToggles(update: Partial<AccessibilityToggleState>): void {
    //1.- Merge the supplied flags with the existing state to honour incremental updates.
    this.toggles = { ...this.toggles, ...update }
  }
}
