import * as THREE from 'three'

export interface VehicleCollisionEnvironment {
  sampleGround: (x: number, z: number) => { height: number; normal: THREE.Vector3; slopeRadians: number }
  sampleCeiling: (x: number, z: number) => number
  sampleWater: (x: number, z: number) => number
  vehicleRadius: number
  slopeLimitRadians: number
  bounceDamping: number
  groundSnapStrength: number
  boundsRadius: number
  waterDrag: number
  waterBuoyancy: number
  waterMinDepth: number
  maxWaterSpeedScale: number
}

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
  verticalAcceleration?: number
  verticalDrag?: number
  gravity?: number
  maxVerticalSpeed?: number
  environment?: Partial<VehicleCollisionEnvironment>
}

interface SimpleVector {
  x: number
  y: number
  z: number
}

export interface VehicleController {
  step: (delta: number, object: THREE.Object3D) => void
  dispose: () => void
  getSpeed: () => number
}

function normaliseKey(value: string): string {
  return value.toLowerCase()
}

function applyQuaternionToVector(vector: SimpleVector, quaternion: THREE.Quaternion): SimpleVector {
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
  const ceilingY = options.ceilingY ?? 60
  const deltaClamp = options.deltaClamp ?? 0.12
  const verticalAcceleration = options.verticalAcceleration ?? 24
  const verticalDrag = options.verticalDrag ?? 2.2
  const gravity = options.gravity ?? 18
  const maxVerticalSpeed = options.maxVerticalSpeed ?? 42

  const defaultEnvironment: VehicleCollisionEnvironment = {
    sampleGround: () => ({ height: groundY, normal: new THREE.Vector3(0, 1, 0), slopeRadians: 0 }),
    sampleCeiling: () => ceilingY,
    sampleWater: () => Number.NEGATIVE_INFINITY,
    vehicleRadius: 2.2,
    slopeLimitRadians: THREE.MathUtils.degToRad(55),
    bounceDamping: 0,
    groundSnapStrength: 10,
    boundsRadius: bounds,
    waterDrag: 0.45,
    waterBuoyancy: 12,
    waterMinDepth: 1.2,
    maxWaterSpeedScale: 0.6,
  }

  const environment: VehicleCollisionEnvironment = {
    ...defaultEnvironment,
    ...options.environment,
  }

  const activeKeys = new Set<string>()
  //1.- Remember the most recent PageUp/PageDown throttle adjustments so acceleration can persist without a held key.
  let latchedThrottle = 0
  const forwardVector: SimpleVector = { x: 0, y: 0, z: -1 }
  const nextPosition: SimpleVector = { x: 0, y: 0, z: 0 }
  const penetrationVector: SimpleVector = { x: 0, y: 0, z: 0 }
  const boundaryDirection: SimpleVector = { x: 0, y: 0, z: 0 }
  const velocity: SimpleVector = { x: 0, y: 0, z: 0 }
  let reportedSpeed = 0

  const addScaled = (target: SimpleVector, direction: SimpleVector, scale: number) => {
    target.x += direction.x * scale
    target.y += direction.y * scale
    target.z += direction.z * scale
  }

  const dot = (a: SimpleVector, b: SimpleVector) => a.x * b.x + a.y * b.y + a.z * b.z

  const setScaled = (target: SimpleVector, source: SimpleVector, scale: number) => {
    target.x = source.x * scale
    target.y = source.y * scale
    target.z = source.z * scale
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    //1.- Capture the pressed key, latch throttle adjustments, and track active modifiers for direct controls.
    const key = normaliseKey(event.key)
    if (key === 'pageup') {
      latchedThrottle = Math.min(1, latchedThrottle + 1)
    } else if (key === 'pagedown') {
      latchedThrottle = Math.max(-1, latchedThrottle - 1)
    }
    activeKeys.add(key)
  }

  const handleKeyUp = (event: KeyboardEvent) => {
    activeKeys.delete(normaliseKey(event.key))
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
  }

  const forwardKeys = ['arrowup']
  const backwardKeys = ['arrowdown']
  const leftKeys = ['a', 'arrowleft']
  const rightKeys = ['d', 'arrowright']

  const brakeKeys = [' ', 'space', 'spacebar']
  const boostKeys = ['shift']
  const ascendKeys = ['r', 'w']
  const descendKeys = ['f', 's', 'control', 'ctrl', 'leftctrl']

  const step = (delta: number, object: THREE.Object3D) => {
    //1.- Determine the frame delta, active control intents, and whether boost or brake modifiers are engaged.
    const dt = Math.min(delta, deltaClamp)
    const directThrottle = (forwardKeys.some((key) => activeKeys.has(key)) ? 1 : 0) -
      (backwardKeys.some((key) => activeKeys.has(key)) ? 1 : 0)
    const forwardIntent = Math.max(-1, Math.min(1, latchedThrottle + directThrottle))
    const turnIntent = (leftKeys.some((key) => activeKeys.has(key)) ? 1 : 0) -
      (rightKeys.some((key) => activeKeys.has(key)) ? 1 : 0)
    const braking = brakeKeys.some((key) => activeKeys.has(key))
    const boosting = boostKeys.some((key) => activeKeys.has(key))
    const ascending = ascendKeys.some((key) => activeKeys.has(key))
    const descending = descendKeys.some((key) => activeKeys.has(key))

    //2.- Apply yaw rotation before sampling the forward vector so acceleration respects the latest heading.
    object.rotation.y += turnIntent * turnSpeed * dt
    forwardVector.x = 0
    forwardVector.y = 0
    forwardVector.z = -1
    applyQuaternionToVector(forwardVector, object.quaternion)

    //3.- Integrate throttle, brake, and drag influences into the velocity so the craft responds smoothly.
    if (forwardIntent > 0) {
      const accel = baseAcceleration * (boosting ? boostAccelerationMultiplier : 1)
      addScaled(velocity, forwardVector, accel * dt)
    } else if (forwardIntent < 0) {
      const reverseAccel = baseAcceleration * reverseAccelerationMultiplier
      addScaled(velocity, forwardVector, -reverseAccel * dt)
    }

    if (braking) {
      const forwardComponent = dot(velocity, forwardVector)
      if (forwardComponent !== 0) {
        const brakeStep = Math.min(Math.abs(forwardComponent), brakeDeceleration * dt)
        addScaled(velocity, forwardVector, -Math.sign(forwardComponent) * brakeStep)
      }
    }

    const dragExponent = dragFactor ** (dt * 60)
    velocity.x *= dragExponent
    velocity.z *= dragExponent

    const forwardComponent = dot(velocity, forwardVector)
    const forwardCap = maxForwardSpeed * (boosting ? boostSpeedMultiplier : 1)
    if (forwardComponent > forwardCap) {
      addScaled(velocity, forwardVector, forwardCap - forwardComponent)
    } else if (forwardComponent < -maxReverseSpeed) {
      addScaled(velocity, forwardVector, -maxReverseSpeed - forwardComponent)
    }

    if (!braking && Math.abs(forwardComponent) < 0.001) {
      addScaled(velocity, forwardVector, -forwardComponent)
    }

    //4.- Integrate vertical thrust, drag, and gravity while smoothing the vertical cap to prevent snapping.
    if (ascending) {
      velocity.y += verticalAcceleration * dt
    }
    if (descending) {
      velocity.y -= verticalAcceleration * dt
    }
    velocity.y -= gravity * dt
    const verticalDamping = Math.exp(-verticalDrag * dt)
    velocity.y *= verticalDamping
    if (velocity.y > maxVerticalSpeed) {
      velocity.y = maxVerticalSpeed + (velocity.y - maxVerticalSpeed) * 0.25
    } else if (velocity.y < -maxVerticalSpeed) {
      velocity.y = -maxVerticalSpeed + (velocity.y + maxVerticalSpeed) * 0.25
    }

    //5.- Predict the next position and apply soft arena bounds before resolving collisions.
    nextPosition.x = object.position.x
    nextPosition.y = object.position.y
    nextPosition.z = object.position.z
    addScaled(nextPosition, velocity, dt)
    const boundsRadius = environment.boundsRadius
    const planarDistance = Math.hypot(nextPosition.x, nextPosition.z)
    if (planarDistance > boundsRadius) {
      const length = Math.hypot(nextPosition.x, nextPosition.z) || 1
      boundaryDirection.x = nextPosition.x / length
      boundaryDirection.y = 0
      boundaryDirection.z = nextPosition.z / length
      const pullBack = planarDistance - boundsRadius
      addScaled(nextPosition, boundaryDirection, -pullBack)
      const outwardSpeed = dot(velocity, boundaryDirection)
      if (outwardSpeed > 0) {
        addScaled(velocity, boundaryDirection, -outwardSpeed)
      }
    }

    //6.- Resolve ground contact by pushing along the surface normal and eliminating inward velocity.
    const groundSample = environment.sampleGround(nextPosition.x, nextPosition.z)
    const groundHeight = groundSample.height + environment.vehicleRadius
    if (nextPosition.y < groundHeight) {
      const penetration = groundHeight - nextPosition.y
      setScaled(penetrationVector, groundSample.normal, penetration)
      addScaled(nextPosition, penetrationVector, 1)
      const intoNormal = dot(velocity, groundSample.normal)
      if (intoNormal < 0) {
        addScaled(velocity, groundSample.normal, -intoNormal * (1 + environment.bounceDamping))
      }
      if (groundSample.slopeRadians > environment.slopeLimitRadians) {
        velocity.x *= 0.35
        velocity.z *= 0.35
      }
    } else {
      const snapHeight = groundHeight + environment.groundSnapStrength * dt
      if (nextPosition.y < snapHeight) {
        const snapPenetration = snapHeight - nextPosition.y
        setScaled(penetrationVector, groundSample.normal, snapPenetration * 0.2)
        addScaled(nextPosition, penetrationVector, 1)
      }
    }

    //7.- Clamp against the ceiling and clear upward velocity when the craft hits the limit.
    const ceilingHeight = environment.sampleCeiling(nextPosition.x, nextPosition.z) - environment.vehicleRadius
    if (nextPosition.y > ceilingHeight) {
      const overshoot = nextPosition.y - ceilingHeight
      nextPosition.y = ceilingHeight
      if (velocity.y > 0) {
        velocity.y = -velocity.y * environment.bounceDamping
      }
      if (overshoot > 0.001) {
        velocity.y -= overshoot * 10 * dt
      }
    }

    //8.- Apply water drag and buoyancy when the craft intersects a lake volume.
    const waterHeight = environment.sampleWater(nextPosition.x, nextPosition.z)
    if (waterHeight !== Number.NEGATIVE_INFINITY && nextPosition.y < waterHeight + environment.vehicleRadius) {
      const depth = waterHeight + environment.vehicleRadius - nextPosition.y
      const clampedDepth = Math.max(environment.waterMinDepth * 0.25, Math.min(depth, environment.waterMinDepth * 2))
      const buoyancy = environment.waterBuoyancy * (clampedDepth / environment.waterMinDepth)
      velocity.y += buoyancy * dt
      if (velocity.y < 0) {
        velocity.y *= 0.35
      }
      const waterDragFactor = Math.max(0, 1 - environment.waterDrag * dt)
      velocity.x *= waterDragFactor
      velocity.z *= waterDragFactor
      const planarSpeed = Math.hypot(velocity.x, velocity.z)
      const waterCap = maxForwardSpeed * environment.maxWaterSpeedScale
      if (planarSpeed > waterCap) {
        const scale = waterCap / planarSpeed
        velocity.x *= scale
        velocity.z *= scale
      }
      if (depth > environment.waterMinDepth) {
        nextPosition.y = waterHeight + environment.vehicleRadius - environment.waterMinDepth
      }
    }

    object.position.x = nextPosition.x
    object.position.y = nextPosition.y
    object.position.z = nextPosition.z

    //9.- Report the signed speed along the craft's forward axis for HUD integration.
    reportedSpeed = dot(velocity, forwardVector)
  }

  const dispose = () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
    activeKeys.clear()
    latchedThrottle = 0
  }

  return {
    step,
    dispose,
    getSpeed: () => reportedSpeed,
  }
}
