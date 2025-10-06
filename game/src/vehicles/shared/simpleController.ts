import * as THREE from 'three'

export function createController(group: THREE.Group){
  const vel = new THREE.Vector3(0,0,60)
  const tmp = new THREE.Vector3()
  const forward = new THREE.Vector3(0,0,-1)
  const mouseWorld = new THREE.Vector2(0,0)

  let speed = 60
  let weaponName = 'GATLING'
  let ammo = 999
  let missiles = 4
  let laserCooldownMs = 0
  let bombArmed = true

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

    // Weapons input (placeholders)
    if (input.pressed('Digit1')) weaponName = 'GATLING'
    if (input.pressed('Digit2')) weaponName = 'MISSILE'
    if (input.pressed('Digit3')) weaponName = 'LASER'
    if (input.pressed('Digit4')) weaponName = 'BOMB'
    // TODO: spawn bullets/missiles/laser/bomb

    // Cooldowns
    if (laserCooldownMs > 0) laserCooldownMs = Math.max(0, laserCooldownMs - dt*1000)
  }

  return {
    update,
    get speed(){ return speed },
    get weaponName(){ return weaponName },
    get ammo(){ return ammo },
    get missiles(){ return missiles },
    get laserCooldownMs(){ return laserCooldownMs },
    get bombArmed(){ return bombArmed }
  }
}
