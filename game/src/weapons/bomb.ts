import * as THREE from 'three'
import { GroundedWeaponContext } from '@/weapons/types'

export type BombOptions = {
  maxConcurrent: number
  ammo: number
  fuseMs: number
  cooldownMs: number
  aoeRadius: number
  craterRadius: number
  debrisCount: number
  gravity: number
}

export type BombState = {
  id: number
  position: THREE.Vector3
  velocity: THREE.Vector3
  fuseMs: number
}

export type ExplosionState = {
  id: number
  center: THREE.Vector3
  radius: number
  craterRadius: number
  debris: THREE.Vector3[]
}

export function createBombSystem(options: BombOptions){
  const bombs: BombState[] = []
  const explosions: ExplosionState[] = []
  let ammo = options.ammo
  let cooldownMs = 0
  let idCounter = 0

  const gravityVec = new THREE.Vector3(0, -options.gravity, 0)
  const tmp = new THREE.Vector3()

  function spawnDebris(center: THREE.Vector3){
    const parts: THREE.Vector3[] = []
    for (let i = 0; i < options.debrisCount; i++){
      //1.- Scatter fragments radially with gentle upward bias for a quick debris visualization.
      const angle = (i / Math.max(1, options.debrisCount)) * Math.PI * 2
      const radius = options.craterRadius * 0.6
      parts.push(new THREE.Vector3(
        center.x + Math.cos(angle) * radius,
        center.y + options.craterRadius * 0.2,
        center.z + Math.sin(angle) * radius,
      ))
    }
    return parts
  }

  function detonate(index: number, context: GroundedWeaponContext){
    const bomb = bombs[index]
    const center = bomb.position.clone()
    const explosion: ExplosionState = {
      id: bomb.id,
      center,
      radius: options.aoeRadius,
      craterRadius: options.craterRadius,
      debris: spawnDebris(center),
    }
    //2.- Record the blast so the HUD/tests can query area-of-effect interactions.
    explosions.push(explosion)
    bombs.splice(index, 1)
    cooldownMs = options.cooldownMs
  }

  function update(context: GroundedWeaponContext){
    if (cooldownMs > 0){
      cooldownMs = Math.max(0, cooldownMs - context.dt * 1000)
    }

    for (let i = bombs.length - 1; i >= 0; i--){
      const bomb = bombs[i]
      bomb.fuseMs -= context.dt * 1000
      if (bomb.fuseMs <= 0){
        detonate(i, context)
        continue
      }

      bomb.velocity.addScaledVector(gravityVec, context.dt)
      bomb.position.addScaledVector(bomb.velocity, context.dt)

      const sample = context.sampleGroundHeight
      if (sample){
        const ground = sample(bomb.position.x, bomb.position.z)
        if (bomb.position.y <= ground){
          //3.- Trigger the fuse early if the shell contacts the terrain before timing out.
          detonate(i, context)
        }
      }
    }
  }

  function fire(context: GroundedWeaponContext){
    if (ammo <= 0) return false
    if (cooldownMs > 0) return false
    if (bombs.length >= options.maxConcurrent) return false

    const bomb: BombState = {
      id: ++idCounter,
      position: context.position.clone(),
      velocity: context.forward.clone().multiplyScalar(60).add(tmp.set(0, -10, 0)),
      fuseMs: options.fuseMs,
    }

    bombs.push(bomb)
    ammo -= 1
    return true
  }

  function queryAoE(point: THREE.Vector3){
    //4.- Provide a helper for tests and gameplay to evaluate explosion overlap.
    return explosions.some(explosion => explosion.center.distanceTo(point) <= explosion.radius)
  }

  return {
    update,
    fire,
    queryAoE,
    get ammo(){ return ammo },
    get cooldownMs(){ return cooldownMs },
    get activeCount(){ return bombs.length },
    get explosions(){ return explosions },
    get isArmed(){ return ammo > 0 && cooldownMs === 0 && bombs.length < options.maxConcurrent },
  }
}
