import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { createChaseCamera } from './chaseCamera'

describe('createChaseCamera', () => {
  it('extends the follow distance as speed increases', () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000)
    const craft = new THREE.Object3D()
    const rig = createChaseCamera({
      baseDistance: 10,
      distanceGain: 10,
      baseHeight: 5,
      heightGain: 0,
      smoothingStrength: 20,
      referenceSpeed: 100,
      deltaClamp: 1,
    })

    //1.- Stabilise the rig at rest to establish how close the chase framing sits during low-speed cruising.
    for (let index = 0; index < 6; index += 1) {
      rig.update(camera, craft, 0, 0.016)
    }
    const restDx = camera.position.x - craft.position.x
    const restDy = camera.position.y - craft.position.y
    const restDz = camera.position.z - craft.position.z
    const restDistance = Math.hypot(restDx, restDy, restDz)

    //2.- Push the virtual craft to a higher velocity so the camera should respond by easing farther back.
    for (let index = 0; index < 12; index += 1) {
      rig.update(camera, craft, 100, 0.016)
    }

    const dx = camera.position.x - craft.position.x
    const dy = camera.position.y - craft.position.y
    const dz = camera.position.z - craft.position.z
    const boostedDistance = Math.hypot(dx, dy, dz)
    expect(boostedDistance).toBeGreaterThan(restDistance + 2)
  })

  it('widens the camera field of view at higher speeds', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000)
    const craft = new THREE.Object3D()
    const rig = createChaseCamera({
      baseFov: 50,
      maxFov: 80,
      smoothingStrength: 20,
      referenceSpeed: 120,
      deltaClamp: 1,
    })

    //1.- Record the field of view when idling to compare against the boosted pass.
    rig.update(camera, craft, 0, 0.016)
    const fovAtRest = camera.fov

    //2.- Advance the simulation at peak throttle to verify that the FOV breathes outward.
    for (let index = 0; index < 6; index += 1) {
      rig.update(camera, craft, 120, 0.016)
    }

    expect(camera.fov).toBeGreaterThan(fovAtRest)
    expect(camera.fov).toBeLessThanOrEqual(80)
  })

  it('looks ahead of the craft to provide anticipation', () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000)
    const craft = new THREE.Object3D()
    craft.rotation.y = Math.PI / 4
    const rig = createChaseCamera({
      smoothingStrength: 20,
      lookAheadDistance: 12,
      deltaClamp: 1,
    })

    //1.- Let the chase rig settle for a handful of frames so the look target reflects the anticipation logic.
    for (let index = 0; index < 6; index += 1) {
      rig.update(camera, craft, 40, 0.016)
    }

    //2.- Compare the aim direction with the craft forward vector to ensure the camera is gazing into upcoming space.
    const baseForward = new THREE.Vector3(-Math.sin(craft.rotation.y), 0, -Math.cos(craft.rotation.y))
    const baseMagnitude = Math.hypot(baseForward.x, baseForward.y, baseForward.z) || 1
    baseForward.x /= baseMagnitude
    baseForward.y /= baseMagnitude
    baseForward.z /= baseMagnitude
    const lookTarget = rig.getLookTarget()
    const direction = new THREE.Vector3(
      lookTarget.x - camera.position.x,
      lookTarget.y - camera.position.y,
      lookTarget.z - camera.position.z,
    )
    const magnitude = Math.hypot(direction.x, direction.y, direction.z) || 1
    direction.x /= magnitude
    direction.y /= magnitude
    direction.z /= magnitude
    const dot = baseForward.x * direction.x + baseForward.y * direction.y + baseForward.z * direction.z
    expect(dot).toBeGreaterThan(0.5)
  })
})
