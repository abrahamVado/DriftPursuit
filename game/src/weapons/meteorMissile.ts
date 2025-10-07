import * as THREE from 'three'
import { WeaponContext, WeaponTarget } from '@/weapons/types'

export type MeteorMissileOptions = {
  maxConcurrent: number
  cooldownMs: number
  ammo: number
  ejectionDurationMs: number
  ejectionSpeed: number
  burnSpeed: number
  navigationConstant: number
  detonationRadius: number
  smokeTrailIntervalMs: number
  maxLifetimeMs: number
}

export type MeteorMissileState = {
  id: number
  position: THREE.Vector3
  velocity: THREE.Vector3
  targetId: string | null
  lifetimeMs: number
  smokeTrail: THREE.Vector3[]
  smokeAccumulatorMs: number
  stage: 'ejecting' | 'burning'
  stageMs: number
}

export type MeteorMissileFireResult = {
  fired: boolean
  missile?: MeteorMissileState
  reason?: string
}

export function createMeteorMissileSystem(options: MeteorMissileOptions){
  const missiles: MeteorMissileState[] = []
  let ammo = options.ammo
  let cooldownMs = 0
  let idCounter = 0

  const forwardTmp = new THREE.Vector3()
  const los = new THREE.Vector3()
  const relVel = new THREE.Vector3()
  const navAccel = new THREE.Vector3()

  //1.- Provide a cheap lookup so ignition always latches onto the same first viable target.
  function acquireFirstTarget(targets: WeaponTarget[]): WeaponTarget | null{
    for (const target of targets){
      if (target.alive){
        return target
      }
    }
    return null
  }

  function detonate(index: number){
    missiles.splice(index, 1)
  }

  function update(context: WeaponContext){
    //2.- Reduce cooldown in real time so callers know when the launcher is ready again.
    if (cooldownMs > 0){
      cooldownMs = Math.max(0, cooldownMs - context.dt * 1000)
    }

    for (let i = missiles.length - 1; i >= 0; i--){
      const missile = missiles[i]
      missile.lifetimeMs += context.dt * 1000
      missile.stageMs += context.dt * 1000

      if (missile.lifetimeMs > options.maxLifetimeMs){
        detonate(i)
        continue
      }

      if (missile.stage === 'ejecting' && missile.stageMs >= options.ejectionDurationMs){
        //3.- On ignition, grab the earliest living target and switch to the powered flight profile.
        const target = acquireFirstTarget(context.targets)
        if (!target){
          detonate(i)
          continue
        }
        missile.stage = 'burning'
        missile.stageMs = 0
        missile.targetId = target.id
        los.copy(target.position).sub(missile.position)
        if (los.lengthSq() > 0.0001){
          los.normalize()
          missile.velocity.copy(los).multiplyScalar(options.burnSpeed)
        } else {
          missile.velocity.set(0, 0, -options.burnSpeed)
        }
      }

      if (missile.stage === 'burning'){
        let target = context.targets.find(t => t.id === missile.targetId && t.alive) ?? null
        if (!target){
          //4.- If the locked contact vanishes, immediately bind to the next available target.
          target = acquireFirstTarget(context.targets)
          if (!target){
            detonate(i)
            continue
          }
          missile.targetId = target.id
        }

        los.copy(target.position).sub(missile.position)
        const distance = los.length()
        if (distance < options.detonationRadius){
          detonate(i)
          continue
        }
        los.normalize()
        relVel.copy(target.velocity).sub(missile.velocity)
        navAccel.copy(relVel.cross(los).cross(los)).multiplyScalar(options.navigationConstant)
        missile.velocity.addScaledVector(navAccel, context.dt)
        missile.velocity.setLength(options.burnSpeed)
      }

      missile.position.addScaledVector(missile.velocity, context.dt)

      missile.smokeAccumulatorMs += context.dt * 1000
      const shouldEmit = missile.stage === 'burning'
      if (shouldEmit && missile.smokeAccumulatorMs >= options.smokeTrailIntervalMs){
        //5.- Drop contrail markers to draw the powered flight path with a simple line strip.
        missile.smokeAccumulatorMs = 0
        missile.smokeTrail.push(missile.position.clone())
        if (missile.smokeTrail.length > 32){
          missile.smokeTrail.shift()
        }
      }
    }
  }

  function tryFire(context: WeaponContext): MeteorMissileFireResult{
    if (ammo <= 0) return { fired: false, reason: 'empty' }
    if (cooldownMs > 0) return { fired: false, reason: 'cooldown' }
    if (missiles.length >= options.maxConcurrent) return { fired: false, reason: 'pool' }

    const missile: MeteorMissileState = {
      id: ++idCounter,
      position: context.position.clone(),
      velocity: forwardTmp.copy(context.forward).multiplyScalar(options.ejectionSpeed),
      targetId: null,
      lifetimeMs: 0,
      smokeTrail: [],
      smokeAccumulatorMs: 0,
      stage: 'ejecting',
      stageMs: 0,
    }

    missiles.push(missile)
    ammo -= 1
    cooldownMs = options.cooldownMs
    return { fired: true, missile }
  }

  return {
    update,
    tryFire,
    get ammo(){ return ammo },
    get cooldownMs(){ return cooldownMs },
    get activeCount(){ return missiles.length },
    get missiles(){ return missiles },
  }
}
