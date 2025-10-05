import { describe, expect, it, vi } from 'vitest'
import { CountdownSpectatorCamera, CameraRig } from './countdownSpectator'
import { CameraDirector } from './cameraDirector'
import { ChaseCameraController, ChaseCameraRuntimeOptions, VehicleTransform } from './chaseCamera'

function createSpectatorCamera() {
  const rig: CameraRig = {
    //1.- No-op rig methods because the countdown camera handles its own math in tests.
    setPosition: vi.fn(),
    lookAt: vi.fn(),
    //2.- Provide optional roll/FOV handlers for compatibility with chase camera logic.
    setRoll: vi.fn(),
    setFov: vi.fn(),
  }
  const focus = { x: 0, y: 0, z: 0 }
  const camera = new CountdownSpectatorCamera(rig, {
    orbitRadius: 5,
    orbitHeight: 2,
    rotationSpeed: Math.PI,
    focus,
  })
  const update = vi.spyOn(camera, 'update')
  return { camera, update }
}

function createChaseCameraStub() {
  const update = vi.fn()
  const trigger = vi.fn()
  const stub: ChaseCameraController = {
    //1.- Defer to spies so tests can ensure the director delegates correctly.
    update: update.mockImplementation(() => {}),
    //2.- Defer to spies so tests can ensure the director forwards events.
    trigger: trigger.mockImplementation(() => {}),
  }
  return { stub, update, trigger }
}

describe('CameraDirector', () => {
  const vehicle: VehicleTransform = {
    position: { x: 1, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: 1 },
    up: { x: 0, y: 1, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    speed: 0,
    boostActive: false,
  }

  it('delegates chase updates when following a vehicle', () => {
    const { stub, update } = createChaseCameraStub()
    const { camera } = createSpectatorCamera()
    const director = new CameraDirector(stub, camera, {
      respawn: { duration: 1, overrides: {} },
    })

    director.follow(vehicle)
    director.update(0.016)

    expect(update).toHaveBeenCalledWith(0.016, vehicle, {})
  })

  it('uses respawn overrides for the configured duration', () => {
    const { stub, update } = createChaseCameraStub()
    const { camera } = createSpectatorCamera()
    const overrides: Partial<ChaseCameraRuntimeOptions> = {
      offsets: {
        position: { x: 0, y: 8, z: -10 },
        lookAt: { x: 0, y: 2, z: 6 },
      },
    }
    const director = new CameraDirector(stub, camera, {
      respawn: { duration: 0.5, overrides },
    })

    director.follow(vehicle)
    director.startRespawn()
    //1.- Step twice to deplete the respawn timer.
    director.update(0.25)
    director.update(0.25)

    expect(update).toHaveBeenCalledWith(0.25, vehicle, overrides)
    expect(update).toHaveBeenLastCalledWith(0.25, vehicle, {})
  })

  it('drives the spectator camera during countdowns', () => {
    const { stub } = createChaseCameraStub()
    const { camera, update: spectatorUpdate } = createSpectatorCamera()
    const director = new CameraDirector(stub, camera, {
      respawn: { duration: 1, overrides: {} },
    })

    director.enterSpectator(3)
    director.update(0.5)

    expect(spectatorUpdate).toHaveBeenCalledWith(0.5, 3)
  })

  it('forwards combat events to the chase camera for FX handling', () => {
    const { stub, trigger } = createChaseCameraStub()
    const { camera } = createSpectatorCamera()
    const director = new CameraDirector(stub, camera, {
      respawn: { duration: 1, overrides: {} },
    })

    director.trigger('boost')

    expect(trigger).toHaveBeenCalledWith('boost')
  })
})
