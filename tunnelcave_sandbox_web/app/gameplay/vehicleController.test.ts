import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createVehicleController } from './vehicleController'

describe('createVehicleController', () => {
  beforeEach(() => {
    //1.- Guarantee a neutral keyboard state before each scenario.
    document.body.innerHTML = ''
  })

  afterEach(() => {
    //1.- Release any listeners added by the controller to avoid side effects between tests.
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 's' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'a' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowUp' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }))
  })

  it('accelerates forward when W is pressed', () => {
    const controller = createVehicleController({ acceleration: 20, maxSpeed: 60, damping: 1 })
    const craft = new THREE.Object3D()
    const startZ = craft.position.z
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }))
    controller.step(1, craft)
    expect(craft.position.z).toBeLessThan(startZ)
    controller.dispose()
  })

  it('applies damping to reduce speed when no input is active', () => {
    const controller = createVehicleController({ acceleration: 30, maxSpeed: 80, damping: 0.5 })
    const craft = new THREE.Object3D()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }))
    controller.step(0.5, craft)
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' }))
    const speedAfterAcceleration = Math.abs(controller.getSpeed())
    controller.step(0.5, craft)
    const speedAfterDamping = Math.abs(controller.getSpeed())
    expect(speedAfterDamping).toBeLessThan(speedAfterAcceleration)
    controller.dispose()
  })

  it('supports arrow keys for accelerating and braking control', () => {
    const controller = createVehicleController({ acceleration: 40, maxSpeed: 120, damping: 1 })
    const craft = new THREE.Object3D()
    //1.- Engage the throttle using the arrow key to confirm speed builds up as expected.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
    controller.step(0.25, craft)
    const speedAfterAccelerating = controller.getSpeed()
    expect(speedAfterAccelerating).toBeGreaterThan(0)

    //2.- Apply the opposite arrow key so the vehicle can bleed speed without forcing reverse motion immediately.
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowUp' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    controller.step(0.25, craft)
    const speedAfterBraking = controller.getSpeed()
    expect(speedAfterBraking).toBeLessThan(speedAfterAccelerating)

    controller.dispose()
  })
})

