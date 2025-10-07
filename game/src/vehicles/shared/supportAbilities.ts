export type SupportAbilityOptions = {
  shieldDurationMs: number
  shieldCooldownMs: number
  healAmount: number
  healCooldownMs: number
  maxHull: number
  dashDurationMs: number
  dashCooldownMs: number
  dashSpeedBonus: number
  ultimateDurationMs: number
  ultimateCooldownMs: number
  ultimateShieldBonusMs: number
  ultimateDashBonusMs: number
}

export type SupportAbilityState = {
  shield: {
    active: boolean
    remainingMs: number
    cooldownRemainingMs: number
  }
  heal: {
    cooldownRemainingMs: number
    hull: number
    maxHull: number
  }
  dash: {
    active: boolean
    remainingMs: number
    cooldownRemainingMs: number
    speedBonus: number
  }
  ultimate: {
    active: boolean
    remainingMs: number
    cooldownRemainingMs: number
  }
}

const DEFAULT_OPTIONS: SupportAbilityOptions = {
  shieldDurationMs: 5000,
  shieldCooldownMs: 8000,
  healAmount: 25,
  healCooldownMs: 6000,
  maxHull: 100,
  dashDurationMs: 1500,
  dashCooldownMs: 5000,
  dashSpeedBonus: 60,
  ultimateDurationMs: 4000,
  ultimateCooldownMs: 16000,
  ultimateShieldBonusMs: 4000,
  ultimateDashBonusMs: 2000,
}

export type SupportAbilitySystem = {
  readonly state: SupportAbilityState
  update: (dt: number) => void
  triggerShield: () => boolean
  triggerHeal: () => boolean
  triggerDash: () => boolean
  triggerUltimate: () => boolean
}

export function createSupportAbilitySystem(overrides: Partial<SupportAbilityOptions> = {}): SupportAbilitySystem {
  const options = { ...DEFAULT_OPTIONS, ...overrides }

  const state: SupportAbilityState = {
    shield: { active: false, remainingMs: 0, cooldownRemainingMs: 0 },
    heal: { cooldownRemainingMs: 0, hull: options.maxHull, maxHull: options.maxHull },
    dash: { active: false, remainingMs: 0, cooldownRemainingMs: 0, speedBonus: options.dashSpeedBonus },
    ultimate: { active: false, remainingMs: 0, cooldownRemainingMs: 0 },
  }

  function update(dt: number) {
    const deltaMs = dt * 1000

    //1.- Decay active timers so effects expire naturally without extra bookkeeping.
    if (state.shield.active) {
      state.shield.remainingMs = Math.max(0, state.shield.remainingMs - deltaMs)
      if (state.shield.remainingMs === 0) {
        state.shield.active = false
      }
    }
    if (state.dash.active) {
      state.dash.remainingMs = Math.max(0, state.dash.remainingMs - deltaMs)
      if (state.dash.remainingMs === 0) {
        state.dash.active = false
      }
    }
    if (state.ultimate.active) {
      state.ultimate.remainingMs = Math.max(0, state.ultimate.remainingMs - deltaMs)
      if (state.ultimate.remainingMs === 0) {
        state.ultimate.active = false
      }
    }

    //2.- Reduce cooldown trackers so triggers can reactivate once the timers elapse.
    state.shield.cooldownRemainingMs = Math.max(0, state.shield.cooldownRemainingMs - deltaMs)
    state.heal.cooldownRemainingMs = Math.max(0, state.heal.cooldownRemainingMs - deltaMs)
    state.dash.cooldownRemainingMs = Math.max(0, state.dash.cooldownRemainingMs - deltaMs)
    state.ultimate.cooldownRemainingMs = Math.max(0, state.ultimate.cooldownRemainingMs - deltaMs)

    //3.- Passively regenerate a trickle of hull while idle so healing has a baseline effect.
    if (!state.ultimate.active) {
      const regen = deltaMs * 0.0025
      state.heal.hull = Math.min(state.heal.maxHull, state.heal.hull + regen)
    }
  }

  function triggerShield() {
    //4.- Allow activation only when the recharge cycle completed.
    if (state.shield.cooldownRemainingMs > 0) return false
    state.shield.active = true
    state.shield.remainingMs = options.shieldDurationMs
    state.shield.cooldownRemainingMs = options.shieldCooldownMs
    return true
  }

  function triggerHeal() {
    //5.- Raise hull integrity while enforcing a cooldown gate to prevent spam.
    if (state.heal.cooldownRemainingMs > 0) return false
    state.heal.cooldownRemainingMs = options.healCooldownMs
    state.heal.hull = Math.min(state.heal.maxHull, state.heal.hull + options.healAmount)
    return true
  }

  function triggerDash() {
    //6.- Start the burst if the thrusters have cooled down enough since the last use.
    if (state.dash.cooldownRemainingMs > 0) return false
    state.dash.active = true
    state.dash.remainingMs = options.dashDurationMs
    state.dash.cooldownRemainingMs = options.dashCooldownMs
    return true
  }

  function triggerUltimate() {
    //7.- Fire the signature move which layers extra shield and dash uptime.
    if (state.ultimate.cooldownRemainingMs > 0) return false
    state.ultimate.active = true
    state.ultimate.remainingMs = options.ultimateDurationMs
    state.ultimate.cooldownRemainingMs = options.ultimateCooldownMs
    state.shield.active = true
    state.shield.remainingMs = Math.max(state.shield.remainingMs, options.ultimateShieldBonusMs)
    state.dash.active = true
    state.dash.remainingMs = Math.max(state.dash.remainingMs, options.ultimateDashBonusMs)
    state.dash.cooldownRemainingMs = Math.max(state.dash.cooldownRemainingMs, options.dashCooldownMs)
    return true
  }

  return {
    state,
    update,
    triggerShield,
    triggerHeal,
    triggerDash,
    triggerUltimate,
  }
}

