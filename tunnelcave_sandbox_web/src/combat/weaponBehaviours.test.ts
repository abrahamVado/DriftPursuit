import { describe, expect, it } from 'vitest'
import { planWeaponFire, planDecoyActivation, resolveMissileSpoof } from './weaponBehaviours'

describe('weaponBehaviours', () => {
  it('computes projectile travel time for shells', () => {
    //1.- Resolve the pulse cannon behaviour over a 780 metre engagement range.
    const plan = planWeaponFire('pulse-cannon', 780)
    //2.- Expect a one second flight time and immutable payload for presentation logic.
    expect(plan.travelTimeSeconds).toBeCloseTo(1, 3)
    expect(Object.isFrozen(plan)).toBe(true)
    expect(plan.behaviour.archetype).toBe('shell')
  })

  it('exposes beam duration for lasers', () => {
    //1.- Scatter laser should present a beam duration without projectile travel time.
    const plan = planWeaponFire('scatter-laser', 200)
    //2.- Ensure lasers remain hitscan while exposing beam persistence for VFX scheduling.
    expect(plan.travelTimeSeconds).toBe(0)
    expect(plan.beamDurationSeconds).toBeGreaterThan(0)
  })

  it('mirrors Go ECM spoof resolution for missiles', () => {
    //1.- Prepare a missile plan with an active decoy and deterministic identifiers.
    const plan = planWeaponFire('micro-missile', 300)
    const options = {
      matchSeed: 'match-seed',
      missileId: 'missile-1',
      targetId: 'target-1',
      decoyActive: true,
    }
    const first = resolveMissileSpoof(plan, options)
    //2.- Re-run the resolution to confirm the roll stays deterministic for replays.
    const second = resolveMissileSpoof(plan, options)
    expect(first).toBe(second)
  })

  it('provides decoy activation windows for HUD feedback', () => {
    //1.- Activate the decoy plan sourced from shared gameplay tuning.
    const activation = planDecoyActivation()
    //2.- Confirm the activation exposes both duration and probability data.
    expect(activation.durationSeconds).toBeGreaterThan(0)
    expect(activation.breakProbability).toBeGreaterThan(0)
    expect(Object.isFrozen(activation)).toBe(true)
  })
})
