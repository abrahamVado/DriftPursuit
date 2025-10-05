import * as THREE from 'three'

export interface ChaseCameraOptions {
  baseDistance?: number
  distanceGain?: number
  baseHeight?: number
  heightGain?: number
  lookAheadDistance?: number
  smoothingStrength?: number
  referenceSpeed?: number
  baseFov?: number
  maxFov?: number
  deltaClamp?: number
  minDistance?: number
  minHeightOffset?: number
}

export interface ChaseCamera {
  update: (camera: THREE.PerspectiveCamera, target: THREE.Object3D, speed: number, delta: number) => void
  getLookTarget: () => THREE.Vector3
}

export function createChaseCamera(options: ChaseCameraOptions = {}): ChaseCamera {
  //1.- Resolve the tunable camera rig parameters and allocate reusable vectors to minimise garbage collection pressure.
  const baseDistance = options.baseDistance ?? 26
  const distanceGain = options.distanceGain ?? 18
  const baseHeight = options.baseHeight ?? 12
  const heightGain = options.heightGain ?? 6
  const lookAheadDistance = options.lookAheadDistance ?? 8
  const smoothingStrength = options.smoothingStrength ?? 6
  const referenceSpeed = options.referenceSpeed ?? 120
  const baseFov = options.baseFov ?? 60
  const maxFov = options.maxFov ?? 74
  const deltaClamp = options.deltaClamp ?? 0.12
  const minDistance = options.minDistance ?? 8
  const minHeightOffset = options.minHeightOffset ?? 3

  const forward = new THREE.Vector3(0, 0, -1)
  const anchor = new THREE.Vector3()
  const lookTarget = new THREE.Vector3()
  const desiredLook = new THREE.Vector3()
  const reportedLook = new THREE.Vector3()
  const applyQuaternionToVector = (vector: THREE.Vector3, quaternion: THREE.Quaternion) => {
    //2.- Inline quaternion rotation handling so the rig functions in lightweight test environments.
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

  const update = (camera: THREE.PerspectiveCamera, target: THREE.Object3D, speed: number, delta: number) => {
    //3.- Clamp the frame step for stability, derive a speed ratio, and expand the follow distance as velocity builds.
    const dt = Math.min(delta, deltaClamp)
    const speedRatio = Math.max(0, Math.min(1, Math.abs(speed) / referenceSpeed))
    const altitude = target.position.y
    const altitudeLift = Math.max(0, Math.min(1, (altitude - 5) / 110))
    const lowAltitudeDamp = Math.max(0, Math.min(1, 1 - altitude / 18))
    const followDistance = baseDistance + distanceGain * speedRatio + altitudeLift * 6
    const baseHeightBlend = baseHeight + heightGain * speedRatio
    const followHeight = baseHeightBlend + altitudeLift * 8 - lowAltitudeDamp * 3

    //4.- Project the target's forward vector to build the anchor point behind and above the craft while respecting minimum spacings.
    forward.set(0, 0, -1)
    applyQuaternionToVector(forward, target.quaternion)
    const verticalOffset = Math.max(minHeightOffset, followHeight)
    anchor.x = target.position.x - forward.x * followDistance
    anchor.y = target.position.y - forward.y * followDistance + verticalOffset
    anchor.z = target.position.z - forward.z * followDistance

    const dx = anchor.x - target.position.x
    const dy = anchor.y - target.position.y
    const dz = anchor.z - target.position.z
    const anchorDistance = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (anchorDistance < minDistance) {
      const pullBack = minDistance - anchorDistance
      anchor.x -= forward.x * pullBack
      anchor.y -= forward.y * pullBack
      anchor.z -= forward.z * pullBack
    }

    if (anchor.y < target.position.y + minHeightOffset) {
      anchor.y = target.position.y + minHeightOffset
    }

    //5.- Ease the physical camera toward the anchor using critically damped smoothing and adjust the FOV proportionally to speed.
    const smoothing = 1 - Math.exp(-smoothingStrength * dt)
    camera.position.x += (anchor.x - camera.position.x) * smoothing
    camera.position.y += (anchor.y - camera.position.y) * smoothing
    camera.position.z += (anchor.z - camera.position.z) * smoothing

    const targetFov = baseFov + (maxFov - baseFov) * speedRatio
    if (Math.abs(camera.fov - targetFov) > 0.001) {
      camera.fov += (targetFov - camera.fov) * smoothing
      camera.updateProjectionMatrix()
    }

    //6.- Aim slightly ahead of the craft so the player receives anticipatory framing without inducing whip-pan motion.
    desiredLook.x = target.position.x + forward.x * lookAheadDistance
    desiredLook.y = target.position.y + forward.y * lookAheadDistance
    desiredLook.z = target.position.z + forward.z * lookAheadDistance
    lookTarget.x += (desiredLook.x - lookTarget.x) * smoothing
    lookTarget.y += (desiredLook.y - lookTarget.y) * smoothing
    lookTarget.z += (desiredLook.z - lookTarget.z) * smoothing
    reportedLook.x = lookTarget.x
    reportedLook.y = lookTarget.y
    reportedLook.z = lookTarget.z
    camera.lookAt(lookTarget.x, lookTarget.y, lookTarget.z)
  }

  return {
    update,
    getLookTarget: () => new THREE.Vector3(reportedLook.x, reportedLook.y, reportedLook.z),
  }
}
