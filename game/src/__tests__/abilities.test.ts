import { describe, expect, it } from 'vitest'
import { createSupportAbilitySystem } from '@/vehicles/shared/supportAbilities'

describe('support ability system', () => {
  it('activates shield for a fixed duration', () => {
    const abilities = createSupportAbilitySystem({ shieldDurationMs: 1000, shieldCooldownMs: 2000 })

    const fired = abilities.triggerShield()
    expect(fired).toBe(true)
    expect(abilities.state.shield.active).toBe(true)

    for (let i = 0; i < 12; i++){
      abilities.update(0.1)
    }

    //1.- After the timer lapses the shield should automatically retract.
    expect(abilities.state.shield.active).toBe(false)
    expect(abilities.state.shield.cooldownRemainingMs).toBeGreaterThan(0)
  })

  it('heals hull while respecting cooldown gates', () => {
    const abilities = createSupportAbilitySystem({ healAmount: 20, healCooldownMs: 1000, maxHull: 100 })

    abilities.state.heal.hull = 40
    const first = abilities.triggerHeal()
    expect(first).toBe(true)
    expect(abilities.state.heal.hull).toBe(60)

    const second = abilities.triggerHeal()
    //2.- Immediate reactivation should fail until the cooldown clears.
    expect(second).toBe(false)

    abilities.update(1.2)
    expect(abilities.triggerHeal()).toBe(true)
    expect(Math.round(abilities.state.heal.hull)).toBeGreaterThanOrEqual(80)
    expect(abilities.state.heal.hull).toBeLessThanOrEqual(abilities.state.heal.maxHull)
  })

  it('ultimate grants concurrent shield and dash uptime', () => {
    const abilities = createSupportAbilitySystem({
      ultimateDurationMs: 1500,
      ultimateCooldownMs: 4000,
      ultimateShieldBonusMs: 1500,
      ultimateDashBonusMs: 1500,
      dashDurationMs: 800,
      dashCooldownMs: 1200,
    })

    const fired = abilities.triggerUltimate()
    expect(fired).toBe(true)
    expect(abilities.state.ultimate.active).toBe(true)
    expect(abilities.state.shield.active).toBe(true)
    expect(abilities.state.dash.active).toBe(true)

    for (let i = 0; i < 20; i++){
      abilities.update(0.1)
    }

    //3.- Once elapsed the ability must return to standby with cooldown applied.
    expect(abilities.state.ultimate.active).toBe(false)
    expect(abilities.state.ultimate.cooldownRemainingMs).toBeGreaterThan(0)
    expect(abilities.state.shield.active).toBe(false)
    expect(abilities.state.dash.active).toBe(false)
  })
})

