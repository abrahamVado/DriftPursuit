import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createMeteorMissileSystem } from '@/weapons/meteorMissile'
import type { WeaponContext } from '@/weapons/types'

describe('meteorMissile', () => {
  it('ignites once ejection travel reaches ten percent of the clearance distance', () => {
    //1.- Configure a launcher with an exaggerated clearance so the shortened ejection distance is obvious.
    const clearanceDistance = 20
    const system = createMeteorMissileSystem({
      maxConcurrent: 4,
      cooldownMs: 0,
      ammo: 3,
      ejectionDurationMs: 5000,
      ejectionSpeed: 10,
      burnSpeed: 40,
      navigationConstant: 4,
      detonationRadius: 5,
      smokeTrailIntervalMs: 100,
      maxLifetimeMs: 30000,
      clearanceDistance,
      swayAmplitude: 0,
      swayFrequency: 1,
    })

    const context: WeaponContext = {
      position: new THREE.Vector3(),
      forward: new THREE.Vector3(0, 0, 1),
      dt: 0.05,
      targets: [],
    }

    //2.- Fire a missile and iterate the simulation until it exits the ejection phase.
    const fireResult = system.tryFire(context)
    expect(fireResult.fired).toBe(true)
    const missile = fireResult.missile!

    const ejectionThreshold = clearanceDistance * 0.1
    let steps = 0
    while (missile.stage === 'ejecting' && steps < 100) {
      system.update(context)
      steps += 1
    }

    //3.- Verify the booster lights once 10% of the clearance has been traveled, well before the physical stand-off distance.
    expect(missile.stage).toBe('burning')
    expect(missile.ejectionTravel).toBeGreaterThanOrEqual(ejectionThreshold)
    expect(missile.ejectionTravel).toBeLessThan(clearanceDistance)
    const elapsedMs = steps * context.dt * 1000
    expect(elapsedMs).toBeLessThan(5000)
  })
})
