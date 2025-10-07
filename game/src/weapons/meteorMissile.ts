import * as THREE from 'three'
import { WeaponContext, WeaponTarget } from '@/weapons/types'

const WORLD_UP = new THREE.Vector3(0, 1, 0)
const NAV_EPSILON = 0.0001
const IMPACT_LIFETIME_MS = 4000

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
  clearanceDistance?: number
  swayAmplitude?: number
  swayFrequency?: number
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
  referenceForward: THREE.Vector3
  ejectionDirection: THREE.Vector3
  ejectionTravel: number
  swayTime: number
  swayAxis: THREE.Vector3
}

export type MeteorMissileImpact = {
  id: number
  targetId: string | null
  center: THREE.Vector3
  ageMs: number
}

export type MeteorMissileFireResult = {
  fired: boolean
  missile?: MeteorMissileState
  reason?: string
}

export function createMeteorMissileSystem(options: MeteorMissileOptions){
  const missiles: MeteorMissileState[] = []
  const impacts: MeteorMissileImpact[] = []
  let ammo = options.ammo
  let cooldownMs = 0
  let idCounter = 0
  let clearanceDistance = Math.max(1, options.clearanceDistance ?? 12)
  const swayAmplitude = options.swayAmplitude ?? 20
  const swayFrequency = options.swayFrequency ?? 1.1

  const forwardTmp = new THREE.Vector3()
  const los = new THREE.Vector3()
  const relVel = new THREE.Vector3()
  const navAccel = new THREE.Vector3()
  const toTarget = new THREE.Vector3()
  const right = new THREE.Vector3()
  const sway = new THREE.Vector3()

  type RankedTarget = { target: WeaponTarget, distance: number }

  //1.- Sort every live contact that sits ahead of the shooter so rails see the full stack of threats.
  function acquireFrontTargets(context: WeaponContext, origin: THREE.Vector3): WeaponTarget[] {
    const ranked: RankedTarget[] = []
    for (const candidate of context.targets){
      if (!candidate.alive) continue
      toTarget.copy(candidate.position).sub(origin)
      const distance = toTarget.length()
      if (distance < NAV_EPSILON) continue
      toTarget.normalize()
      if (toTarget.dot(context.forward) <= 0) continue
      ranked.push({ target: candidate, distance })
    }
    ranked.sort((a, b) => a.distance - b.distance)
    return ranked.map(entry => entry.target)
  }

  function refreshSwayAxis(missile: MeteorMissileState){
    missile.swayAxis.copy(missile.referenceForward).cross(WORLD_UP)
    if (missile.swayAxis.lengthSq() < NAV_EPSILON){
      missile.swayAxis.set(1, 0, 0)
    }
    missile.swayAxis.normalize()
  }

  function igniteMissile(missile: MeteorMissileState, context: WeaponContext){
    missile.stage = 'burning'
    missile.stageMs = 0
    missile.swayTime = 0
    const ranked = acquireFrontTargets(context, missile.position)
    const target = ranked[0] ?? null
    missile.targetId = target?.id ?? null
    if (target){
      los.copy(target.position).sub(missile.position)
      if (los.lengthSq() > NAV_EPSILON){
        los.normalize()
        missile.velocity.copy(los).multiplyScalar(options.burnSpeed)
        missile.referenceForward.copy(los)
      }
    } else {
      missile.velocity.copy(missile.referenceForward).multiplyScalar(options.burnSpeed)
    }
    refreshSwayAxis(missile)
  }

  function registerImpact(missile: MeteorMissileState, target: WeaponTarget | null){
    if (target){
      target.alive = false
      target.onFire = true
      target.falling = true
      target.velocity.y = Math.min(target.velocity.y, -options.burnSpeed * 0.25)
    }
    impacts.push({
      id: missile.id,
      targetId: target?.id ?? null,
      center: missile.position.clone(),
      ageMs: 0,
    })
    if (impacts.length > 24){
      impacts.splice(0, impacts.length - 24)
    }
  }

  function detonate(index: number){
    missiles.splice(index, 1)
  }

  function update(context: WeaponContext){
    //2.- Reduce cooldown and age explosion decals so follow-up salvos stay in sync with HUD timers.
    if (cooldownMs > 0){
      cooldownMs = Math.max(0, cooldownMs - context.dt * 1000)
    }
    for (let i = impacts.length - 1; i >= 0; i--){
      const impact = impacts[i]
      impact.ageMs += context.dt * 1000
      if (impact.ageMs > IMPACT_LIFETIME_MS){
        impacts.splice(i, 1)
      }
    }

    for (let i = missiles.length - 1; i >= 0; i--){
      const missile = missiles[i]
      missile.lifetimeMs += context.dt * 1000
      missile.stageMs += context.dt * 1000

      if (missile.lifetimeMs > options.maxLifetimeMs){
        detonate(i)
        continue
      }

      if (missile.stage === 'ejecting'){
        const travel = options.ejectionSpeed * context.dt
        missile.position.addScaledVector(missile.ejectionDirection, travel)
        missile.velocity.copy(missile.ejectionDirection).multiplyScalar(options.ejectionSpeed)
        missile.ejectionTravel += travel
        if (missile.ejectionTravel >= clearanceDistance || missile.stageMs >= options.ejectionDurationMs){
          igniteMissile(missile, context)
        }
      } else {
        missile.swayTime += context.dt
        let target = context.targets.find(t => t.id === missile.targetId && t.alive) ?? null
        if (!target){
          const ranked = acquireFrontTargets(context, missile.position)
          target = ranked[0] ?? null
          missile.targetId = target?.id ?? null
        }

        let hasTarget = false
        if (target){
          los.copy(target.position).sub(missile.position)
          const distance = los.length()
          if (distance < options.detonationRadius){
            registerImpact(missile, target)
            detonate(i)
            continue
          }
          los.normalize()
          relVel.copy(target.velocity).sub(missile.velocity)
          navAccel.copy(relVel.cross(los).cross(los)).multiplyScalar(options.navigationConstant)
          missile.velocity.addScaledVector(navAccel, context.dt)
          hasTarget = true
        }

        missile.referenceForward.copy(missile.velocity).normalize()
        refreshSwayAxis(missile)
        if (hasTarget){
          const phase = Math.sin(missile.swayTime * swayFrequency * Math.PI * 2)
          sway.copy(missile.swayAxis).multiplyScalar(phase * swayAmplitude * context.dt)
          missile.velocity.add(sway)
          missile.velocity.setLength(options.burnSpeed)
        } else {
          missile.velocity.copy(missile.referenceForward).multiplyScalar(options.burnSpeed)
        }
      }

      missile.position.addScaledVector(missile.velocity, context.dt)

      if (missile.stage === 'burning'){
        for (const candidate of context.targets){
          if (!candidate.alive) continue
          const distance = candidate.position.distanceTo(missile.position)
          if (distance < options.detonationRadius){
            registerImpact(missile, candidate)
            detonate(i)
            break
          }
        }
        if (!missiles[i]) continue
      }

      missile.smokeAccumulatorMs += context.dt * 1000
      const shouldEmit = missile.stage === 'burning'
      if (shouldEmit && missile.smokeAccumulatorMs >= options.smokeTrailIntervalMs){
        //3.- Drop contrail markers to draw the powered flight path with a simple line strip.
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

    forwardTmp.copy(context.forward)
    if (forwardTmp.lengthSq() < NAV_EPSILON){
      forwardTmp.set(0, 0, -1)
    }
    forwardTmp.normalize()
    right.copy(forwardTmp).cross(WORLD_UP)
    if (right.lengthSq() < NAV_EPSILON){
      right.set(1, 0, 0)
    }
    right.normalize()

    const missile: MeteorMissileState = {
      id: ++idCounter,
      position: context.position.clone().addScaledVector(right, clearanceDistance * 0.6),
      velocity: forwardTmp.clone().multiplyScalar(options.ejectionSpeed),
      targetId: null,
      lifetimeMs: 0,
      smokeTrail: [],
      smokeAccumulatorMs: 0,
      stage: 'ejecting',
      stageMs: 0,
      referenceForward: forwardTmp.clone(),
      ejectionDirection: forwardTmp.clone(),
      ejectionTravel: 0,
      swayTime: 0,
      swayAxis: right.clone(),
    }

    missiles.push(missile)
    ammo -= 1
    cooldownMs = options.cooldownMs
    return { fired: true, missile }
  }

  function setLauncherClearance(distance: number){
    clearanceDistance = Math.max(1, distance)
  }

  return {
    update,
    tryFire,
    setLauncherClearance,
    get ammo(){ return ammo },
    get cooldownMs(){ return cooldownMs },
    get activeCount(){ return missiles.length },
    get missiles(){ return missiles },
    get impacts(){ return impacts },
  }
}
