export type ControlAxis =
  | 'throttle'
  | 'brake'
  | 'steer'
  | 'handbrake'
  | 'boost'
  | 'gear'

export type BindingMode = 'positive' | 'negative' | 'toggle'

export type ControlAction =
  | 'Accelerate'
  | 'Brake / Reverse'
  | 'Steer Left'
  | 'Steer Right'
  | 'Handbrake'
  | 'Boost'
  | 'Shift Down'
  | 'Shift Up'

export interface KeybindingDefinition {
  //1.- Describe the semantic action triggered by the control.
  action: ControlAction
  //2.- Persist the default keyboard event code shipped with the game.
  defaultKey: string
  //3.- Connect the action to the gameplay axis that consumes the input value.
  axis: ControlAxis
  //4.- Explain how the axis is driven when the key is held or toggled.
  mode: BindingMode
}

export const DEFAULT_BINDING_DEFINITIONS: KeybindingDefinition[] = [
  {
    action: 'Accelerate',
    defaultKey: 'KeyW',
    axis: 'throttle',
    mode: 'positive',
  },
  {
    action: 'Brake / Reverse',
    defaultKey: 'KeyS',
    axis: 'brake',
    mode: 'positive',
  },
  {
    action: 'Steer Left',
    defaultKey: 'KeyA',
    axis: 'steer',
    mode: 'negative',
  },
  {
    action: 'Steer Right',
    defaultKey: 'KeyD',
    axis: 'steer',
    mode: 'positive',
  },
  {
    action: 'Handbrake',
    defaultKey: 'Space',
    axis: 'handbrake',
    mode: 'toggle',
  },
  {
    action: 'Boost',
    defaultKey: 'ShiftLeft',
    axis: 'boost',
    mode: 'toggle',
  },
  {
    action: 'Shift Down',
    defaultKey: 'KeyQ',
    axis: 'gear',
    mode: 'negative',
  },
  {
    action: 'Shift Up',
    defaultKey: 'KeyE',
    axis: 'gear',
    mode: 'positive',
  },
]

export interface KeybindingOverride {
  //1.- Replacement keyboard event code supplied by the player.
  key: string
}

export type KeybindingOverrides = Partial<Record<ControlAction, KeybindingOverride>>

export interface Keybinding {
  //1.- Keyboard event code currently assigned to the action.
  key: string
  //2.- Semantic action string displayed across UI surfaces.
  action: ControlAction
  //3.- Axis connected to the underlying vehicle input.
  axis: ControlAxis
  //4.- Direction or toggle state used when translating into control values.
  mode: BindingMode
  //5.- Default keyboard event code stored for accessibility reset flows.
  defaultKey: string
}

export interface AccessibilitySummary {
  //1.- Semantic action that can be remapped.
  action: ControlAction
  //2.- Currently assigned keyboard event code.
  key: string
  //3.- Reference keyboard event code representing the default layout.
  defaultKey: string
}

export class KeybindingConfiguration {
  private readonly bindings: Map<ControlAction, Keybinding>

  private constructor(bindings: Map<ControlAction, Keybinding>) {
    //1.- Persist the merged binding table for runtime lookups.
    this.bindings = bindings
  }

  static withDefaults(overrides: KeybindingOverrides = {}): KeybindingConfiguration {
    //1.- Seed the map using the baked in defaults so accessibility menus can revert later.
    const merged = new Map<ControlAction, Keybinding>()
    for (const definition of DEFAULT_BINDING_DEFINITIONS) {
      const override = overrides[definition.action]
      const key = override?.key ?? definition.defaultKey
      merged.set(definition.action, {
        key,
        action: definition.action,
        axis: definition.axis,
        mode: definition.mode,
        defaultKey: definition.defaultKey,
      })
    }
    return new KeybindingConfiguration(merged)
  }

  withOverrides(overrides: KeybindingOverrides = {}): KeybindingConfiguration {
    //1.- Build a fresh configuration applying overrides on top of the current selection.
    const next = new Map<ControlAction, Keybinding>()
    for (const binding of this.bindings.values()) {
      const override = overrides[binding.action]
      const key = override?.key ?? binding.key
      next.set(binding.action, { ...binding, key })
    }
    return new KeybindingConfiguration(next)
  }

  describe(): Keybinding[] {
    //1.- Return a deterministic array for rendering and testing.
    return [...this.bindings.values()].sort((a, b) => a.action.localeCompare(b.action))
  }

  findByKey(key: string): Keybinding | undefined {
    //1.- Locate bindings by keyboard event code to dispatch gameplay input events.
    for (const binding of this.bindings.values()) {
      if (binding.key === key) {
        return binding
      }
    }
    return undefined
  }

  listDefaults(): Keybinding[] {
    //1.- Expose the original default keys regardless of user overrides.
    return [...this.bindings.values()]
      .map((binding) => ({ ...binding, key: binding.defaultKey }))
      .sort((a, b) => a.action.localeCompare(b.action))
  }

  accessibilitySummaries(): AccessibilitySummary[] {
    //1.- Produce paired current/default keys for accessibility option menus.
    return this.describe().map((binding) => ({
      action: binding.action,
      key: binding.key,
      defaultKey: binding.defaultKey,
    }))
  }
}

export const createKeybindingConfiguration = (overrides: KeybindingOverrides = {}): KeybindingConfiguration => {
  //1.- Provide a convenience constructor mirroring the static helper.
  return KeybindingConfiguration.withDefaults(overrides)
}
