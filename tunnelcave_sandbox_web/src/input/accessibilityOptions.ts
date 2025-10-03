import {
  AccessibilitySummary,
  KeybindingConfiguration,
  KeybindingOverrides,
  createKeybindingConfiguration,
} from './keybindings'

export class AccessibilityOptions {
  private config: KeybindingConfiguration

  constructor(config: KeybindingConfiguration = createKeybindingConfiguration()) {
    //1.- Retain a mutable configuration that can be reissued when overrides are applied.
    this.config = config
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
}
