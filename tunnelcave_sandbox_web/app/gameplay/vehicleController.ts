import * as THREE from 'three'

export interface VehicleControllerOptions {
  baseAcceleration?: number
  brakeDeceleration?: number
  dragFactor?: number
  maxForwardSpeed?: number
  maxReverseSpeed?: number
  boostSpeedMultiplier?: number
  boostAccelerationMultiplier?: number
  reverseAccelerationMultiplier?: number
  turnSpeed?: number
  bounds?: number
  groundY?: number
  ceilingY?: number
  deltaClamp?: number
}

export interface VehicleController {
  step: (delta: number, object: THREE.Object3D) => void
  dispose: () => void
  getSpeed: () => number
}

function normaliseKey(value: string): string {
  return value.toLowerCase()
}

function applyQuaternionToVector(vector: THREE.Vector3, quaternion: THREE.Quaternion): THREE.Vector3 {
  //1.- Expand the quaternion rotation in-line so tests can run without relying on Three.js prototype helpers.
  const vx = vector.x
  const vy = vector.y
  const vz = vector.z
  const qx = quaternion.x
  const qy = quaternion.y
  const qz = quaternion.z
  const qw = quaternion.w

  const ix = qw * vx + qy * vz - qz * vy
  const iy = qw * vy + qz * vx - qx * vz
  const iz = qw * vz + qx * vy - qy * vx
  const iw = -qx * vx - qy * vy - qz * vz

  vector.x = ix * qw + iw * -qx + iy * -qz - iz * -qy
  vector.y = iy * qw + iw * -qy + iz * -qx - ix * -qz
  vector.z = iz * qw + iw * -qz + ix * -qy - iy * -qx
  return vector
}

export function createVehicleController(options: VehicleControllerOptions = {}): VehicleController {
  const baseAcceleration = options.baseAcceleration ?? 32
  const brakeDeceleration = options.brakeDeceleration ?? 90
  const dragFactor = options.dragFactor ?? 0.94
  const maxForwardSpeed = options.maxForwardSpeed ?? 120
  const maxReverseSpeed = options.maxReverseSpeed ?? 36
  const boostSpeedMultiplier = options.boostSpeedMultiplier ?? 1.35
  const boostAccelerationMultiplier = options.boostAccelerationMultiplier ?? 1.18
  const reverseAccelerationMultiplier = options.reverseAccelerationMultiplier ?? 0.55
  const turnSpeed = options.turnSpeed ?? Math.PI
  const bounds = options.bounds ?? 160
  const groundY = options.groundY ?? -16
  const ceilingY = options.ceilingY ?? 40
  const deltaClamp = options.deltaClamp ?? 0.12

  const activeKeys = new Set<string>()
  let speed = 0
  const forwardVector = new THREE.Vector3(0, 0, -1)

  const handleKeyDown = (event: KeyboardEvent) => {
    activeKeys.add(normaliseKey(event.key))
  }

  const handleKeyUp = (event: KeyboardEvent) => {
    activeKeys.delete(normaliseKey(event.key))
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
  }

  const forwardKeys = ['w', 'arrowup']
  const backwardKeys = ['s', 'arrowdown']
  const leftKeys = ['a', 'arrowleft']
  const rightKeys = ['d', 'arrowright']

  const brakeKeys = [' ', 'space', 'spacebar']
  const boostKeys = ['shift']

  const step = (delta: number, object: THREE.Object3D) => {
    //1.- Determine the frame delta, active control intents, and whether boost or brake modifiers are engaged.
    const dt = Math.min(delta, deltaClamp)
    const forwardIntent = (forwardKeys.some((key) => activeKeys.has(key)) ? 1 : 0) -
      (backwardKeys.some((key) => activeKeys.has(key)) ? 1 : 0)
    const turnIntent = (leftKeys.some((key) => activeKeys.has(key)) ? 1 : 0) -
      (rightKeys.some((key) => activeKeys.has(key)) ? 1 : 0)
    const braking = brakeKeys.some((key) => activeKeys.has(key))
    const boosting = boostKeys.some((key) => activeKeys.has(key))

    //2.- Integrate throttle, brake, and drag influences into the scalar speed so the craft responds smoothly.
    if (forwardIntent > 0) {
      const accel = baseAcceleration * (boosting ? boostAccelerationMultiplier : 1)
      speed += accel * dt
    } else if (forwardIntent < 0) {
      const reverseAccel = baseAcceleration * reverseAccelerationMultiplier
      speed -= reverseAccel * dt
    }

    if (braking) {
      const brakeStep = brakeDeceleration * dt
      if (speed > 0) {
        speed = Math.max(0, speed - brakeStep)
      } else {
        speed = Math.min(0, speed + brakeStep)
      }
    }

    const dragExponent = dt * 60
    speed *= dragFactor ** dragExponent

    const forwardCap = maxForwardSpeed * (boosting ? boostSpeedMultiplier : 1)
    if (speed > forwardCap) {
      speed = forwardCap
    } else if (speed < -maxReverseSpeed) {
      speed = -maxReverseSpeed
    }

    if (!braking && Math.abs(speed) < 0.001) {
      speed = 0
    }

    //3.- Rotate around the Y-axis and translate along the craft's local forward vector using the integrated speed.
    object.rotation.y += turnIntent * turnSpeed * dt
    forwardVector.set(0, 0, -1)
    applyQuaternionToVector(forwardVector, object.quaternion)
    const moveScale = speed * dt
    object.position.x += forwardVector.x * moveScale
    object.position.y += forwardVector.y * moveScale
    object.position.z += forwardVector.z * moveScale

    //4.- Clamp the craft inside the battlefield volume so play remains contained within the arena.
    object.position.x = Math.max(-bounds, Math.min(bounds, object.position.x))
    object.position.z = Math.max(-bounds, Math.min(bounds, object.position.z))
    object.position.y = Math.max(groundY + 1, Math.min(ceilingY - 1, object.position.y))
  }

  const dispose = () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
    activeKeys.clear()
  }

  return {
    step,
    dispose,
    getSpeed: () => speed,
  }
}

