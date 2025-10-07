import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createController } from '../simpleController'

describe('simpleController mouse steering', () => {
  it('yaws left when the mouse moves right', () => {
    //1.- Compose a controller with neutral orientation to sample yaw updates deterministically.
    const group = new THREE.Group()
    const scene = new THREE.Scene()
    const controller = createController(group, scene)
    const input = {
      mouse: { x: 1, y: 0 },
      pressed: (_code: string) => false,
    }

    //2.- Advance one frame and verify smoothing trends the yaw toward a negative heading.
    controller.update(1 / 60, input, () => 0)

    expect(group.rotation.y).toBeLessThan(0)

    //3.- Dispose resources to avoid leaking visuals into subsequent tests.
    controller.dispose()
  })
})
