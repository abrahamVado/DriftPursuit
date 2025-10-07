import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createController } from '../simpleController'

describe('simpleController pointer lock steering', () => {
  it('accumulates yaw beyond 360 degrees with successive pointer deltas', () => {
    //1.- Seed a controller and pointer state locked to ensure relative deltas are consumed.
    const group = new THREE.Group()
    const scene = new THREE.Scene()
    const pointer = { locked: true, deltaX: 0, deltaY: 0, yaw: 0, pitch: 0 }
    const input = {
      pointer,
      mouse: { x: 0, y: 0 },
      pressed: (_code: string) => false,
    }
    const controller = createController(group, scene)

    for (let i = 0; i < 8; i += 1) {
      pointer.deltaX = 200
      controller.update(1 / 60, input, () => 0)
    }

    expect(Math.abs(group.rotation.y)).toBeGreaterThan(Math.PI)
    expect(pointer.deltaX).toBe(0)

    controller.dispose()
  })

  it('falls back to NDC smoothing when pointer lock is not active', () => {
    //1.- Validate that the legacy reticle mapping still updates yaw without pointer lock support.
    const group = new THREE.Group()
    const scene = new THREE.Scene()
    const input = {
      pointer: { locked: false, deltaX: 0, deltaY: 0, yaw: 0, pitch: 0 },
      mouse: { x: 1, y: 0 },
      pressed: (_code: string) => false,
    }
    const controller = createController(group, scene)

    for (let i = 0; i < 10; i += 1) {
      controller.update(1 / 60, input, () => 0)
    }

    expect(group.rotation.y).toBeLessThan(0)

    controller.dispose()
  })
})
