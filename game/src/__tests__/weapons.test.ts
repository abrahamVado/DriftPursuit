import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createHomingMissileSystem } from '@/weapons/homingMissile'
import { createNeonLaserSystem } from '@/weapons/neonLaser'
import { createBombSystem } from '@/weapons/bomb'
import { createGatlingSystem } from '@/weapons/gatling'
import type { WeaponContext, WeaponTarget } from '@/weapons/types'

function makeContext(overrides: Partial<WeaponContext> = {}): WeaponContext{
  const base: WeaponContext = {
    position: new THREE.Vector3(),
    forward: new THREE.Vector3(0,0,-1),
    dt: 0.1,
    targets: [],
  }
  return Object.assign(base, overrides)
}

describe('homing missile system', () => {
  it('retargets when the tracked enemy dies mid-flight', () => {
    const system = createHomingMissileSystem({
      maxConcurrent: 2,
      cooldownMs: 500,
      ammo: 2,
      speed: 100,
      navigationConstant: 4,
      lockConeDeg: 60,
      smokeTrailIntervalMs: 50,
      detonationRadius: 2,
      maxLifetimeMs: 8000,
    })

    const primary: WeaponTarget = {
      id: 'alpha',
      position: new THREE.Vector3(0,0,-200),
      velocity: new THREE.Vector3(),
      alive: true,
    }
    const secondary: WeaponTarget = {
      id: 'bravo',
      position: new THREE.Vector3(10,0,-210),
      velocity: new THREE.Vector3(),
      alive: true,
    }

    const context = makeContext({ targets: [primary, secondary] })

    const fired = system.tryFire(context)
    expect(fired.fired).toBe(true)

    for (let i = 0; i < 5; i++){
      system.update(context)
    }

    //1.- Simulate the primary target being destroyed so the missile must react.
    primary.alive = false
    for (let i = 0; i < 3; i++){
      system.update(context)
    }

    const missile = system.missiles[0]
    expect(missile).toBeDefined()
    expect(missile?.targetId).toBe('bravo')
  })
})

describe('neon laser system', () => {
  it('enforces cooldown before allowing a new beam', () => {
    const system = createNeonLaserSystem({
      cooldownMs: 1000,
      durationMs: 200,
      range: 300,
      attenuation: 0.005,
    })

    const context = makeContext()

    const first = system.fire(context)
    expect(first).toBe(true)
    system.update(context)

    //2.- Immediately attempting another beam should be rejected until cooldown finishes.
    expect(system.fire(context)).toBe(false)

    for (let i = 0; i < 15; i++){
      system.update(makeContext({ dt: 0.1 }))
    }

    expect(system.fire(context)).toBe(true)
  })
})

describe('bomb system', () => {
  it('detonates after the fuse and reports AoE overlap', () => {
    const system = createBombSystem({
      maxConcurrent: 1,
      ammo: 1,
      fuseMs: 500,
      cooldownMs: 0,
      aoeRadius: 20,
      craterRadius: 6,
      debrisCount: 4,
      gravity: 9.8,
    })

    const context = makeContext()
    const fired = system.fire({ ...context, sampleGroundHeight: () => -100 })
    expect(fired).toBe(true)

    for (let i = 0; i < 6; i++){
      system.update({ ...context, sampleGroundHeight: () => -100 })
    }

    expect(system.explosions.length).toBeGreaterThan(0)

    const center = system.explosions[0]?.center
    if (!center){
      throw new Error('expected explosion center')
    }

    //3.- Confirm the query helper reports points within the radius as affected.
    expect(system.queryAoE(center.clone())).toBe(true)
    expect(system.queryAoE(center.clone().add(new THREE.Vector3(30,0,0)))).toBe(false)
  })
})

describe('gatling system', () => {
  it('recovers from overheat after cooling down', () => {
    const system = createGatlingSystem({
      fireRate: 120,
      spread: THREE.MathUtils.degToRad(2),
      maxTracers: 8,
      tracerLifeMs: 100,
      ammo: 200,
      heatPerShot: 20,
      coolRate: 40,
      overheatThreshold: 60,
    })

    const context = makeContext({ dt: 0.05 })

    for (let i = 0; i < 10 && !system.overheated; i++){
      system.update(context, true)
    }

    expect(system.overheated).toBe(true)

    for (let i = 0; i < 20; i++){
      system.update(makeContext({ dt: 0.1 }), false)
    }

    expect(system.overheated).toBe(false)

    const result = system.update(context, true)
    //4.- After cooling the cannon should resume firing rounds.
    expect(result.shots).toBeGreaterThan(0)
  })
})
