import * as THREE from 'three'
import { createGatlingSystem } from '@/weapons/gatling'
import { createHomingMissileSystem } from '@/weapons/homingMissile'
import { createNeonLaserSystem } from '@/weapons/neonLaser'
import { createBombSystem } from '@/weapons/bomb'
import type { WeaponContext, WeaponTarget } from '@/weapons/types'

export function createController(group: THREE.Group){
  const vel = new THREE.Vector3(0,0,60)
  const forward = new THREE.Vector3(0,0,-1)
  const weaponContext: WeaponContext = {
    position: new THREE.Vector3(),
    forward: new THREE.Vector3(0,0,-1),
    dt: 0,
    targets: []
  }
  let targetProvider: () => WeaponTarget[] = () => []

  const gatling = createGatlingSystem({
    fireRate: 25,
    spread: THREE.MathUtils.degToRad(1.5),
    maxTracers: 32,
    tracerLifeMs: 250,
    ammo: 1200,
    heatPerShot: 1,
    coolRate: 12,
    overheatThreshold: 120,
  })

  const missilesSystem = createHomingMissileSystem({
    maxConcurrent: 4,
    cooldownMs: 1200,
    ammo: 4,
    speed: 180,
    navigationConstant: 3,
    lockConeDeg: 45,
    smokeTrailIntervalMs: 80,
    detonationRadius: 4,
    maxLifetimeMs: 12000,
  })

  const laserSystem = createNeonLaserSystem({
    cooldownMs: 2000,
    durationMs: 600,
    range: 800,
    attenuation: 0.002,
  })

  const bombSystem = createBombSystem({
    maxConcurrent: 2,
    ammo: 6,
    fuseMs: 2500,
    cooldownMs: 1500,
    aoeRadius: 40,
    craterRadius: 18,
    debrisCount: 8,
    gravity: 30,
  })

  let speed = 60
  let weaponName = 'GATLING'
  let ammo = gatling.ammo
  let missiles = missilesSystem.ammo
  let laserCooldownMs = laserSystem.cooldownMs
  let bombArmed = bombSystem.isArmed
  let fireHeld = false
  let fireJustPressed = false
  let fireJustReleased = false

  function update(dt:number, input:any, queryHeight:(x:number,z:number)=>number){
    // Mouse steering: aim reticle in NDC controls yaw/pitch
    const targetYaw = input.mouse.x * 0.6
    const targetPitch = input.mouse.y * 0.4
    group.rotation.y += (targetYaw - group.rotation.y) * (1 - Math.exp(-6*dt))
    group.rotation.x += (targetPitch - group.rotation.x) * (1 - Math.exp(-6*dt))

    // Keys
    if (input.pressed('KeyW')) speed += 40*dt
    if (input.pressed('KeyS')) speed -= 40*dt
    if (input.pressed('ShiftLeft')) speed += 80*dt
    if (input.pressed('KeyQ')) group.rotation.z += 1.2*dt
    if (input.pressed('KeyE')) group.rotation.z -= 1.2*dt
    speed = Math.max(10, Math.min(160, speed))

    // Integrate
    forward.set(0,0,-1).applyEuler(group.rotation)
    vel.copy(forward).multiplyScalar(speed)
    group.position.addScaledVector(vel, dt)
    ;(group as any).userData.speed = speed

    // Terrain floor constraint
    const floor = queryHeight(group.position.x, group.position.z) + 6
    if (group.position.y < floor) {
      group.position.y = floor
      vel.y = Math.abs(vel.y)*0.2
    }

    // Ceiling clamp
    const ceiling = 2000
    if (group.position.y > ceiling) group.position.y = ceiling

    const previouslyHeld = fireHeld
    fireHeld = Boolean(input.pressed('Space'))
    fireJustPressed = fireHeld && !previouslyHeld
    fireJustReleased = !fireHeld && previouslyHeld

    // Weapons input (placeholders)
    if (input.pressed('Digit1')) weaponName = 'GATLING'
    if (input.pressed('Digit2')) weaponName = 'MISSILE'
    if (input.pressed('Digit3')) weaponName = 'LASER'
    if (input.pressed('Digit4')) weaponName = 'BOMB'

    weaponContext.position.copy(group.position)
    weaponContext.forward.copy(forward)
    weaponContext.dt = dt
    weaponContext.targets = targetProvider()

    if (weaponName === 'GATLING'){
      //1.- Advance the hitscan gun and respect trigger state.
      gatling.update(weaponContext, fireHeld)
    } else {
      gatling.update(weaponContext, false)
    }

    if (weaponName === 'MISSILE' && fireJustPressed){
      //2.- Launch homing missiles when ammo and pool constraints allow.
      missilesSystem.tryFire(weaponContext)
    }
    missilesSystem.update(weaponContext)

    if (weaponName === 'LASER'){
      if (fireJustPressed){
        laserSystem.fire(weaponContext)
      }
      if (fireHeld){
        laserSystem.sustain(weaponContext)
      }
      if (fireJustReleased){
        laserSystem.release()
      }
    } else {
      if (laserSystem.state.active){
        laserSystem.release()
      }
    }
    laserSystem.update(weaponContext)

    if (weaponName === 'BOMB' && fireJustPressed){
      //3.- Drop a bomb while relaying the terrain sampler to trigger ground detonation.
      bombSystem.fire({ ...weaponContext, sampleGroundHeight: queryHeight })
    }
    bombSystem.update({ ...weaponContext, sampleGroundHeight: queryHeight })

    // Cooldowns
    ammo = gatling.ammo
    missiles = missilesSystem.ammo
    laserCooldownMs = laserSystem.cooldownMs
    bombArmed = bombSystem.isArmed
  }

  return {
    update,
    get speed(){ return speed },
    get weaponName(){ return weaponName },
    get ammo(){ return ammo },
    get missiles(){ return missiles },
    get laserCooldownMs(){ return laserCooldownMs },
    get bombArmed(){ return bombArmed },
    setTargetProvider(provider: () => WeaponTarget[]){
      targetProvider = provider
    }
  }
}
