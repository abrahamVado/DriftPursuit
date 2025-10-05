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
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }))
  })

  it('accelerates toward the forward cap when W is held', () => {
    const controller = createVehicleController({
      baseAcceleration: 60,
      maxForwardSpeed: 100,
      dragFactor: 1,
    })
    const craft = new THREE.Object3D()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }))
    for (let index = 0; index < 60; index += 1) {
      controller.step(0.1, craft)
    }
    expect(controller.getSpeed()).toBeCloseTo(100, 0)
    controller.dispose()
  })

  it('coasts down smoothly from drag when inputs are released', () => {
    const controller = createVehicleController({
      baseAcceleration: 50,
      maxForwardSpeed: 80,
      dragFactor: 0.9,
    })
    const craft = new THREE.Object3D()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }))
    controller.step(0.4, craft)
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' }))
    const speedBeforeDrag = controller.getSpeed()
    controller.step(0.4, craft)
    const speedAfterDrag = controller.getSpeed()
    expect(Math.abs(speedAfterDrag)).toBeLessThan(Math.abs(speedBeforeDrag))
    controller.dispose()
  })

  it('applies strong braking toward zero when space is pressed', () => {
    const controller = createVehicleController({
      baseAcceleration: 40,
      brakeDeceleration: 200,
      dragFactor: 1,
    })
    const craft = new THREE.Object3D()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }))
    controller.step(0.3, craft)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
    controller.step(0.1, craft)
    expect(controller.getSpeed()).toBeCloseTo(0, 1)
    controller.dispose()
  })

  it('limits reverse speed even when S is held for a long duration', () => {
    const controller = createVehicleController({
      baseAcceleration: 30,
      maxForwardSpeed: 120,
      maxReverseSpeed: 20,
      dragFactor: 1,
    })
    const craft = new THREE.Object3D()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }))
    for (let index = 0; index < 40; index += 1) {
      controller.step(0.1, craft)
    }
    expect(controller.getSpeed()).toBeGreaterThanOrEqual(-20)
    controller.dispose()
  })

  it('raises the speed cap when boost is active', () => {
    const controller = createVehicleController({
      baseAcceleration: 60,
      maxForwardSpeed: 90,
      boostSpeedMultiplier: 1.5,
      dragFactor: 1,
    })
    const craft = new THREE.Object3D()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }))
    for (let index = 0; index < 60; index += 1) {
      controller.step(0.1, craft)
    }
    expect(controller.getSpeed()).toBeCloseTo(135, 0)
    controller.dispose()
  })
})

