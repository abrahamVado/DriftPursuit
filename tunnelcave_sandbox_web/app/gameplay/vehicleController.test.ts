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
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'r' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'f' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'PageUp' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'PageDown' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Ctrl' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'LeftCtrl' }))
  })

  it('accelerates toward the forward cap when the throttle key is held', () => {
    const controller = createVehicleController({
      baseAcceleration: 60,
      maxForwardSpeed: 100,
      dragFactor: 1,
      bounds: 1000,
    })
    const craft = new THREE.Object3D()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
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
      bounds: 1000,
    })
    const craft = new THREE.Object3D()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
    controller.step(0.4, craft)
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowUp' }))
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
      bounds: 1000,
    })
    const craft = new THREE.Object3D()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
    controller.step(0.3, craft)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
    controller.step(0.1, craft)
    expect(controller.getSpeed()).toBeCloseTo(0, 1)
    controller.dispose()
  })

  it('limits reverse speed even when PageDown is held for a long duration', () => {
    const controller = createVehicleController({
      baseAcceleration: 30,
      maxForwardSpeed: 120,
      maxReverseSpeed: 20,
      dragFactor: 1,
      bounds: 1000,
    })
    const craft = new THREE.Object3D()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' }))
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
      bounds: 1000,
    })
    const craft = new THREE.Object3D()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
    for (let index = 0; index < 60; index += 1) {
      controller.step(0.1, craft)
    }
    expect(controller.getSpeed()).toBeCloseTo(135, 0)
    controller.dispose()
  })

  it('latches throttle when PageUp is tapped', () => {
    const controller = createVehicleController({
      baseAcceleration: 40,
      maxForwardSpeed: 90,
      dragFactor: 1,
      bounds: 1000,
    })
    const craft = new THREE.Object3D()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'PageUp' }))
    for (let index = 0; index < 60; index += 1) {
      controller.step(0.1, craft)
    }
    expect(controller.getSpeed()).toBeCloseTo(90, 0)
    controller.dispose()
  })

  it('ratchets the latched throttle downward when PageDown is pressed', () => {
    const controller = createVehicleController({
      baseAcceleration: 50,
      maxForwardSpeed: 80,
      dragFactor: 0.9,
      bounds: 1000,
    })
    const craft = new THREE.Object3D()
    //1.- Engage a forward latch, allow the craft to build speed, and capture the resulting velocity.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'PageUp' }))
    for (let index = 0; index < 20; index += 1) {
      controller.step(0.1, craft)
    }
    const latchedForwardSpeed = controller.getSpeed()
    //2.- Ratchet the throttle down with PageDown and confirm sustained steps now bleed off velocity.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'PageDown' }))
    for (let index = 0; index < 30; index += 1) {
      controller.step(0.1, craft)
    }
    expect(controller.getSpeed()).toBeLessThan(latchedForwardSpeed)
    controller.dispose()
  })

  it('supports vertical thrust while gravity draws the craft back down', () => {
    const controller = createVehicleController({
      verticalAcceleration: 40,
      gravity: 12,
      deltaClamp: 1,
      dragFactor: 1,
    })
    const craft = new THREE.Object3D()
    //1.- Engage upward thrust and confirm altitude increases beyond the default hover level.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }))
    controller.step(0.6, craft)
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' }))
    expect(craft.position.y).toBeGreaterThan(0.1)
    const peakHeight = craft.position.y
    //2.- Release inputs and allow gravity to reel the craft toward the ground plane.
    for (let index = 0; index < 6; index += 1) {
      controller.step(0.4, craft)
    }
    expect(craft.position.y).toBeLessThan(peakHeight)
    controller.dispose()
  })

  it('prevents tunnelling through ground and ceiling planes', () => {
    const environment = {
      sampleGround: () => ({ height: 0, normal: new THREE.Vector3(0, 1, 0), slopeRadians: 0 }),
      sampleCeiling: () => 10,
      sampleWater: () => Number.NEGATIVE_INFINITY,
      vehicleRadius: 1.2,
      slopeLimitRadians: Math.PI / 3,
      bounceDamping: 0,
      groundSnapStrength: 8,
      boundsRadius: 120,
      waterDrag: 0.4,
      waterBuoyancy: 14,
      waterMinDepth: 1.5,
      maxWaterSpeedScale: 0.5,
    }
    const controller = createVehicleController({
      verticalAcceleration: 50,
      gravity: 20,
      deltaClamp: 1,
      dragFactor: 1,
      environment,
    })
    const craft = new THREE.Object3D()
    //1.- Force a steep descent and ensure the craft never dips below the buffered ground height.
    craft.position.set(0, 4, 0)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }))
    for (let index = 0; index < 8; index += 1) {
      controller.step(0.2, craft)
    }
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'f' }))
    expect(craft.position.y).toBeGreaterThanOrEqual(environment.vehicleRadius - 0.01)

    //2.- Drive the craft into the ceiling volume and verify it clamps before penetrating.
    craft.position.set(0, 8, 0)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))
    for (let index = 0; index < 8; index += 1) {
      controller.step(0.2, craft)
    }
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'r' }))
    expect(craft.position.y).toBeLessThanOrEqual(environment.sampleCeiling(0, 0) - environment.vehicleRadius + 0.01)
    controller.dispose()
  })

  it('applies drag and buoyancy when entering water volumes', () => {
    const environment = {
      sampleGround: () => ({ height: 0, normal: new THREE.Vector3(0, 1, 0), slopeRadians: 0 }),
      sampleCeiling: () => 40,
      sampleWater: () => 2,
      vehicleRadius: 1.2,
      slopeLimitRadians: Math.PI / 3,
      bounceDamping: 0,
      groundSnapStrength: 6,
      boundsRadius: 160,
      waterDrag: 0.6,
      waterBuoyancy: 18,
      waterMinDepth: 1.4,
      maxWaterSpeedScale: 0.5,
    }
    const controller = createVehicleController({
      baseAcceleration: 40,
      dragFactor: 1,
      maxForwardSpeed: 60,
      deltaClamp: 1,
      environment,
    })
    const craft = new THREE.Object3D()
    //1.- Build forward momentum above the waterline so we can observe the drag response.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
    for (let index = 0; index < 10; index += 1) {
      controller.step(0.2, craft)
    }
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowUp' }))
    const speedBeforeWater = controller.getSpeed()
    craft.position.y = 2.4
    //2.- Step the simulation with the craft partially submerged and ensure buoyancy and drag clamp its motion.
    controller.step(0.5, craft)
    expect(controller.getSpeed()).toBeLessThan(speedBeforeWater)
    expect(craft.position.y).toBeGreaterThanOrEqual(environment.sampleWater(0, 0) + environment.vehicleRadius - environment.waterMinDepth - 0.01)
    controller.dispose()
  })

  it('wraps planar movement into the seamless tile when wrap size is configured', () => {
    const wrapSize = 40
    const environment = {
      sampleGround: () => ({ height: 0, normal: new THREE.Vector3(0, 1, 0), slopeRadians: 0 }),
      sampleCeiling: () => 60,
      sampleWater: () => Number.NEGATIVE_INFINITY,
      vehicleRadius: 1.2,
      slopeLimitRadians: Math.PI / 3,
      bounceDamping: 0,
      groundSnapStrength: 6,
      boundsRadius: 120,
      waterDrag: 0.4,
      waterBuoyancy: 14,
      waterMinDepth: 1.2,
      maxWaterSpeedScale: 0.6,
      wrapSize,
    }
    const controller = createVehicleController({
      baseAcceleration: 40,
      maxForwardSpeed: 80,
      dragFactor: 1,
      deltaClamp: 0.2,
      environment,
    })
    const craft = new THREE.Object3D()
    //1.- Place the craft beyond the positive seam so the next frame evaluates wrapping logic.
    craft.position.set(wrapSize / 2 + 5, 0, 0)
    controller.step(0.1, craft)
    //2.- Confirm the craft appears on the opposite side of the tile rather than clamping against bounds.
    expect(craft.position.x).toBeLessThan(0)
    expect(Math.abs(craft.position.x)).toBeLessThanOrEqual(wrapSize / 2)
    controller.dispose()
  })
})

