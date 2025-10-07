import * as THREE from 'three'
import { createGatlingSystem } from '@/weapons/gatling'
import { createNeonLaserSystem } from '@/weapons/neonLaser'
import { createBombSystem } from '@/weapons/bomb'
import { createHomingMissileVisual } from '@/weapons/visuals/homingMissileVisual'
import { createNeonLaserVisual } from '@/weapons/visuals/neonLaserVisual'
import { createMeteorMissileSystem } from '@/weapons/meteorMissile'
import type { WeaponContext, WeaponTarget } from '@/weapons/types'
import { createSupportAbilitySystem } from '@/vehicles/shared/supportAbilities'
import { createAbilityVisuals } from '@/vehicles/shared/abilityVisuals'

type AbilitySlot =
  | 'METEOR_RED'
  | 'METEOR_VIOLET'
  | 'LASER'
  | 'BOMB'
  | 'GATLING'
  | 'SHIELD'
  | 'HEAL'
  | 'DASH'
  | 'ULTIMATE'

export function createController(group: THREE.Group, scene: THREE.Scene){
  const vel = new THREE.Vector3(0,0,60)
  const forward = new THREE.Vector3(0,0,-1)
  const weaponContext: WeaponContext = {
    position: new THREE.Vector3(),
    forward: new THREE.Vector3(0,0,-1),
    dt: 0,
    targets: []
  }
  let targetProvider: () => WeaponTarget[] = () => []

  const bounds = new THREE.Box3()
  const size = new THREE.Vector3()

  function computeLauncherClearance(){
    bounds.setFromObject(group)
    bounds.getSize(size)
    const span = Math.max(size.x, size.y, size.z)
    const distance = Math.max(5, span * 5)
    meteorRedSystem.setLauncherClearance(distance)
    meteorVioletSystem.setLauncherClearance(distance)
  }

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

  const meteorRedSystem = createMeteorMissileSystem({
    maxConcurrent: 2,
    cooldownMs: 2200,
    ammo: Number.POSITIVE_INFINITY,
    ejectionDurationMs: 1000,
    ejectionSpeed: 40,
    burnSpeed: 220,
    navigationConstant: 3.5,
    detonationRadius: 6,
    smokeTrailIntervalMs: 70,
    maxLifetimeMs: 15000,
    clearanceDistance: 30,
    swayAmplitude: 24,
    swayFrequency: 1.2,
  })

  const meteorVioletSystem = createMeteorMissileSystem({
    maxConcurrent: 2,
    cooldownMs: 2200,
    ammo: Number.POSITIVE_INFINITY,
    ejectionDurationMs: 900,
    ejectionSpeed: 42,
    burnSpeed: 225,
    navigationConstant: 3.6,
    detonationRadius: 6,
    smokeTrailIntervalMs: 70,
    maxLifetimeMs: 15000,
    clearanceDistance: 30,
    swayAmplitude: 26,
    swayFrequency: 1.25,
  })

  const meteorRedVisual = createHomingMissileVisual(scene, {
    body: 0xff4d4f,
    emissive: 0xff826a,
    trail: 0xffc2a1,
  })

  const meteorVioletVisual = createHomingMissileVisual(scene, {
    body: 0x8c54ff,
    emissive: 0xca8dff,
    trail: 0xd8b4ff,
  })

  const laserSystem = createNeonLaserSystem({
    cooldownMs: 2000,
    durationMs: 600,
    range: 800,
    attenuation: 0.002,
  })

  const laserVisual = createNeonLaserVisual(scene, { color: 0x61f6ff })

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

  const abilitySystem = createSupportAbilitySystem()
  const abilityVisuals = createAbilityVisuals(group)

  let baseSpeed = 60
  let effectiveSpeed = baseSpeed
  let yaw = group.rotation.y
  let pitch = group.rotation.x
  let activeSlot: AbilitySlot = 'METEOR_RED'
  let ammo = gatling.ammo
  let missiles = Number.POSITIVE_INFINITY
  let laserCooldownMs = laserSystem.cooldownMs
  let bombArmed = bombSystem.isArmed
  let hull = abilitySystem.state.heal.hull
  let shieldActive = abilitySystem.state.shield.active
  let dashActive = abilitySystem.state.dash.active
  let ultimateActive = abilitySystem.state.ultimate.active
  let fireHeld = false
  let fireJustPressed = false
  let fireJustReleased = false
  const slotLabels: Record<AbilitySlot, string> = {
    METEOR_RED: 'METEOR BVRAAM R',
    METEOR_VIOLET: 'METEOR BVRAAM V',
    LASER: 'NEON LASER',
    BOMB: 'GRAV BOMB',
    GATLING: 'GATLING',
    SHIELD: 'SHIELD',
    HEAL: 'HEAL',
    DASH: 'DASH',
    ULTIMATE: 'ULTIMATE',
  }

  computeLauncherClearance()

  function update(dt:number, input:any, queryHeight:(x:number,z:number)=>number){
    //1.- Mouse steering: accumulate pointer-lock deltas for yaw while clamping pitch and fall back to NDC when unlocked.
    const pointer = input.pointer as undefined | { locked: boolean; deltaX: number; deltaY: number; yaw: number; pitch: number }
    const pitchLimit = THREE.MathUtils.degToRad(35)
    if (pointer?.locked){
      yaw += pointer.deltaX * -0.0025
      pitch += pointer.deltaY * 0.002
      pitch = THREE.MathUtils.clamp(pitch, -pitchLimit, pitchLimit)
      pointer.yaw = yaw
      pointer.pitch = pitch
      pointer.deltaX = 0
      pointer.deltaY = 0
    } else {
      const targetYaw = input.mouse.x * -0.6
      const targetPitch = input.mouse.y * 0.4
      yaw += (targetYaw - yaw) * (1 - Math.exp(-6*dt))
      pitch += (targetPitch - pitch) * (1 - Math.exp(-6*dt))
      pitch = THREE.MathUtils.clamp(pitch, -pitchLimit, pitchLimit)
    }

    group.rotation.y = yaw
    group.rotation.x = pitch

    // Keys
    if (input.pressed('KeyW')) baseSpeed += 40*dt
    if (input.pressed('KeyS')) baseSpeed -= 40*dt
    if (input.pressed('ShiftLeft')) baseSpeed += 80*dt
    if (input.pressed('KeyQ')) group.rotation.z += 1.2*dt
    if (input.pressed('KeyE')) group.rotation.z -= 1.2*dt
    baseSpeed = Math.max(10, Math.min(160, baseSpeed))

    // Integrate
    forward.set(0,0,-1).applyEuler(group.rotation)
    const dashBonus = abilitySystem.state.dash.active ? abilitySystem.state.dash.speedBonus : 0
    const ultimateBonus = abilitySystem.state.ultimate.active ? abilitySystem.state.dash.speedBonus * 0.5 : 0
    effectiveSpeed = baseSpeed + dashBonus + ultimateBonus
    vel.copy(forward).multiplyScalar(effectiveSpeed)
    group.position.addScaledVector(vel, dt)
    ;(group as any).userData.speed = effectiveSpeed

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

    if (input.pressed('Digit1')) activeSlot = 'METEOR_RED'
    if (input.pressed('Digit2')) activeSlot = 'METEOR_VIOLET'
    if (input.pressed('Digit3')) activeSlot = 'LASER'
    if (input.pressed('Digit4')) activeSlot = 'BOMB'
    if (input.pressed('Digit5')) activeSlot = 'GATLING'
    if (input.pressed('Digit6')) activeSlot = 'SHIELD'
    if (input.pressed('Digit7')) activeSlot = 'HEAL'
    if (input.pressed('Digit8')) activeSlot = 'DASH'
    if (input.pressed('Digit9')) activeSlot = 'ULTIMATE'

    weaponContext.position.copy(group.position)
    weaponContext.forward.copy(forward)
    weaponContext.dt = dt
    weaponContext.targets = targetProvider()

    if (fireJustPressed){
      switch (activeSlot){
        case 'METEOR_RED':
          //1.- Launch a crimson BVRAAM when the red slot is tapped.
          meteorRedSystem.tryFire(weaponContext)
          break
        case 'METEOR_VIOLET':
          //2.- Dispatch the violet BVRAAM variant with the same keystroke cadence.
          meteorVioletSystem.tryFire(weaponContext)
          break
        case 'LASER':
          laserSystem.fire(weaponContext)
          break
        case 'BOMB':
          bombSystem.fire({ ...weaponContext, sampleGroundHeight: queryHeight })
          break
        case 'GATLING':
          //3.- Immediate effect handled through the continuous fire branch.
          break
        case 'SHIELD':
          abilitySystem.triggerShield()
          break
        case 'HEAL':
          abilitySystem.triggerHeal()
          break
        case 'DASH':
          abilitySystem.triggerDash()
          break
        case 'ULTIMATE':
          abilitySystem.triggerUltimate()
          break
      }
    }

    meteorRedSystem.update(weaponContext)
    meteorVioletSystem.update(weaponContext)
    meteorRedVisual.update(meteorRedSystem.missiles)
    meteorVioletVisual.update(meteorVioletSystem.missiles)

    if (activeSlot === 'GATLING'){
      //4.- Advance the hitscan gun and respect trigger state when the slot is active.
      gatling.update(weaponContext, fireHeld)
    } else {
      gatling.update(weaponContext, false)
    }

    if (activeSlot === 'LASER'){
      if (fireHeld){
        laserSystem.sustain(weaponContext)
      }
      if (fireJustReleased){
        laserSystem.release()
      }
    } else if (laserSystem.state.active){
      laserSystem.release()
    }
    laserSystem.update(weaponContext)
    //5.- Stretch and orient the neon beam according to the freshly sampled weapon state.
    laserVisual.update(laserSystem.state)

    bombSystem.update({ ...weaponContext, sampleGroundHeight: queryHeight })

    // Cooldowns
    ammo = gatling.ammo
    missiles = Number.POSITIVE_INFINITY
    laserCooldownMs = laserSystem.cooldownMs
    bombArmed = bombSystem.isArmed
    abilitySystem.update(dt)
    abilityVisuals.update(abilitySystem.state, group)
    hull = abilitySystem.state.heal.hull
    shieldActive = abilitySystem.state.shield.active
    dashActive = abilitySystem.state.dash.active
    ultimateActive = abilitySystem.state.ultimate.active
  }

  function dispose(){
    //6.- Tear down transient weapon meshes so hot swaps between vehicles stay safe.
    meteorRedVisual.dispose()
    meteorVioletVisual.dispose()
    laserVisual.dispose()
    abilityVisuals.dispose(group)
  }

  return {
    update,
    refreshVehicleClearance: computeLauncherClearance,
    get speed(){ return effectiveSpeed },
    get weaponName(){ return slotLabels[activeSlot] },
    get activeSlot(){ return activeSlot },
    get ammo(){ return ammo },
    get missiles(){ return missiles },
    get laserCooldownMs(){ return laserCooldownMs },
    get bombArmed(){ return bombArmed },
    get abilityState(){ return abilitySystem.state },
    get hull(){ return hull },
    get shieldActive(){ return shieldActive },
    get dashActive(){ return dashActive },
    get ultimateActive(){ return ultimateActive },
    setTargetProvider(provider: () => WeaponTarget[]){
      targetProvider = provider
    },
    dispose,
  }
}
