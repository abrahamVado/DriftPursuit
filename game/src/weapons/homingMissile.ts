import * as THREE from 'three'
import { WeaponContext, WeaponTarget } from '@/weapons/types'

export type HomingMissileOptions = {
  maxConcurrent: number
  cooldownMs: number
  ammo: number
  speed: number
  navigationConstant: number
  lockConeDeg: number
  smokeTrailIntervalMs: number
  detonationRadius: number
  maxLifetimeMs: number
}

export type HomingMissileState = {
  id: number
  position: THREE.Vector3
  velocity: THREE.Vector3
  targetId: string | null
  lifetimeMs: number
  smokeTrail: THREE.Vector3[]
  smokeAccumulatorMs: number
}

export type HomingMissileFireResult = {
  fired: boolean
  missile?: HomingMissileState
  reason?: string
}

export function createHomingMissileSystem(options: HomingMissileOptions){
  const missiles: HomingMissileState[] = []
  let ammo = options.ammo
  let cooldownMs = 0
  let idCounter = 0

  const toTarget = new THREE.Vector3()
  const los = new THREE.Vector3()
  const relVel = new THREE.Vector3()
  const navAccel = new THREE.Vector3()
  const forwardTmp = new THREE.Vector3()

  //1.- Clamp expensive configuration upfront so the system always behaves predictably.
  const coneCos = Math.cos(THREE.MathUtils.degToRad(Math.max(0.1, Math.min(89.9, options.lockConeDeg))))

  function acquireTarget(context: WeaponContext, origin: THREE.Vector3){
    let best: WeaponTarget | null = null
    let bestDot = coneCos
    for (const target of context.targets){
      if (!target.alive) continue
      toTarget.copy(target.position).sub(origin)
      const distance = toTarget.length()
      if (distance <= 0.001) continue
      toTarget.divideScalar(distance)
      const dot = toTarget.dot(context.forward)
      if (dot < bestDot) continue
      bestDot = dot
      best = target
    }
    return best
  }

  function detonate(index: number){
    missiles.splice(index, 1)
  }

  function update(context: WeaponContext){
    //2.- Reduce global cooldown so the caller knows when the next missile is ready.
    if (cooldownMs > 0){
      cooldownMs = Math.max(0, cooldownMs - context.dt * 1000)
    }

    for (let i = missiles.length - 1; i >= 0; i--){
      const missile = missiles[i]
      missile.lifetimeMs += context.dt * 1000
      if (missile.lifetimeMs > options.maxLifetimeMs){
        detonate(i)
        continue
      }

      let target = context.targets.find(t => t.id === missile.targetId && t.alive) ?? null
      if (!target){
        //3.- Automatically reacquire the best available target inside the cone when the original dies.
        const reacquired = acquireTarget(context, missile.position)
        missile.targetId = reacquired?.id ?? null
        target = reacquired
      }

      if (target){
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
        missile.velocity.setLength(options.speed)
      }

      missile.position.addScaledVector(missile.velocity, context.dt)

      missile.smokeAccumulatorMs += context.dt * 1000
      if (missile.smokeAccumulatorMs >= options.smokeTrailIntervalMs){
        //4.- Append downsampled smoke trail points to emulate the visual exhaust ribbon.
        missile.smokeAccumulatorMs = 0
        missile.smokeTrail.push(missile.position.clone())
        if (missile.smokeTrail.length > 32){
          missile.smokeTrail.shift()
        }
      }
    }
  }

  function tryFire(context: WeaponContext): HomingMissileFireResult{
    if (ammo <= 0) return { fired: false, reason: 'empty' }
    if (cooldownMs > 0) return { fired: false, reason: 'cooldown' }
    if (missiles.length >= options.maxConcurrent) return { fired: false, reason: 'pool' }

    const target = acquireTarget(context, context.position)
    if (!target) return { fired: false, reason: 'no-target' }

    const missile: HomingMissileState = {
      id: ++idCounter,
      position: context.position.clone(),
      velocity: forwardTmp.copy(context.forward).multiplyScalar(options.speed),
      targetId: target.id,
      lifetimeMs: 0,
      smokeTrail: [],
      smokeAccumulatorMs: 0,
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
