export type FlightControlAxis =
  | 'pitch'
  | 'roll'
  | 'yaw'
  | 'throttle'
  | 'flaps'
  | 'gear'
  | 'engine'
  | 'camera'
  | 'airbrake'

export type FlightBindingMode = 'positive' | 'negative' | 'toggle' | 'increment'

export interface FlightKeybindingDefinition {
  action: FlightControlAction
  defaultKey: string
  axis: FlightControlAxis
  mode: FlightBindingMode
  step?: number
}

export type FlightControlAction =
  | 'Pitch Down'
  | 'Pitch Up'
  | 'Roll Left'
  | 'Roll Right'
  | 'Yaw Left'
  | 'Yaw Right'
  | 'Throttle Increase'
  | 'Throttle Decrease'
  | 'Throttle Fine Increase'
  | 'Throttle Fine Decrease'
  | 'Toggle Flaps'
  | 'Toggle Landing Gear'
  | 'Toggle Engine'
  | 'Toggle Freelook'
  | 'Toggle Alternate Camera'
  | 'Hold Wheel Brakes / Airbrake'

export interface FlightKeybinding {
  action: FlightControlAction
  key: string
  axis: FlightControlAxis
  mode: FlightBindingMode
  defaultKey: string
  step?: number
}

export type FlightKeybindingOverrides = Partial<Record<FlightControlAction, { key: string }>>

export const DEFAULT_FLIGHT_BINDINGS: FlightKeybindingDefinition[] = [
  { action: 'Pitch Down', defaultKey: 'KeyW', axis: 'pitch', mode: 'positive' },
  { action: 'Pitch Up', defaultKey: 'KeyS', axis: 'pitch', mode: 'negative' },
  { action: 'Roll Left', defaultKey: 'KeyA', axis: 'roll', mode: 'negative' },
  { action: 'Roll Right', defaultKey: 'KeyD', axis: 'roll', mode: 'positive' },
  { action: 'Yaw Left', defaultKey: 'KeyQ', axis: 'yaw', mode: 'negative' },
  { action: 'Yaw Right', defaultKey: 'KeyE', axis: 'yaw', mode: 'positive' },
  { action: 'Throttle Increase', defaultKey: 'ShiftLeft', axis: 'throttle', mode: 'increment', step: 0.08 },
  { action: 'Throttle Decrease', defaultKey: 'ControlLeft', axis: 'throttle', mode: 'increment', step: -0.08 },
  { action: 'Throttle Fine Increase', defaultKey: 'WheelUp', axis: 'throttle', mode: 'increment', step: 0.02 },
  { action: 'Throttle Fine Decrease', defaultKey: 'WheelDown', axis: 'throttle', mode: 'increment', step: -0.02 },
  { action: 'Toggle Flaps', defaultKey: 'KeyF', axis: 'flaps', mode: 'toggle' },
  { action: 'Toggle Landing Gear', defaultKey: 'KeyG', axis: 'gear', mode: 'toggle' },
  { action: 'Toggle Engine', defaultKey: 'KeyI', axis: 'engine', mode: 'toggle' },
  { action: 'Toggle Freelook', defaultKey: 'KeyC', axis: 'camera', mode: 'toggle' },
  { action: 'Toggle Alternate Camera', defaultKey: 'KeyV', axis: 'camera', mode: 'toggle' },
  { action: 'Hold Wheel Brakes / Airbrake', defaultKey: 'KeyB', axis: 'airbrake', mode: 'toggle' },
]

export class FlightKeybindingConfiguration {
  private readonly bindings: Map<FlightControlAction, FlightKeybinding>

  private constructor(bindings: Map<FlightControlAction, FlightKeybinding>) {
    //1.- Preserve the merged flight bindings to drive runtime control lookups.
    this.bindings = bindings
  }

  static withDefaults(overrides: FlightKeybindingOverrides = {}): FlightKeybindingConfiguration {
    //1.- Merge overrides against the baked-in War Thunder inspired control scheme.
    const merged = new Map<FlightControlAction, FlightKeybinding>()
    for (const definition of DEFAULT_FLIGHT_BINDINGS) {
      const override = overrides[definition.action]
      const key = override?.key ?? definition.defaultKey
      merged.set(definition.action, {
        action: definition.action,
        key,
        axis: definition.axis,
        mode: definition.mode,
        defaultKey: definition.defaultKey,
        step: definition.step,
      })
    }
    return new FlightKeybindingConfiguration(merged)
  }

  describe(): FlightKeybinding[] {
    //1.- Emit a predictable binding list for UI renderers and tests.
    return [...this.bindings.values()].sort((a, b) => a.action.localeCompare(b.action))
  }

  withOverrides(overrides: FlightKeybindingOverrides = {}): FlightKeybindingConfiguration {
    //1.- Produce a new configuration that applies additional overrides without mutating the current map.
    const next = new Map<FlightControlAction, FlightKeybinding>()
    for (const binding of this.bindings.values()) {
      const override = overrides[binding.action]
      const key = override?.key ?? binding.key
      next.set(binding.action, { ...binding, key })
    }
    return new FlightKeybindingConfiguration(next)
  }

  findByKey(key: string): FlightKeybinding | undefined {
    //1.- Locate bindings by hardware key code so gameplay systems can react to input events.
    for (const binding of this.bindings.values()) {
      if (binding.key === key) {
        return binding
      }
    }
    return undefined
  }

  listDefaults(): FlightKeybinding[] {
    //1.- Surface the original defaults while retaining per-action metadata for accessibility menus.
    return this.describe().map((binding) => ({
      ...binding,
      key: binding.defaultKey,
    }))
  }

  accessibilitySummaries(): Array<{ action: FlightControlAction; key: string; defaultKey: string }> {
    //1.- Pair the active key with its default counterpart for quick UI summaries.
    return this.describe().map((binding) => ({
      action: binding.action,
      key: binding.key,
      defaultKey: binding.defaultKey,
    }))
  }
}

export const createFlightKeybindingConfiguration = (overrides: FlightKeybindingOverrides = {}): FlightKeybindingConfiguration => {
  //1.- Convenience helper that mirrors the standard constructor signature.
  return FlightKeybindingConfiguration.withDefaults(overrides)
}
