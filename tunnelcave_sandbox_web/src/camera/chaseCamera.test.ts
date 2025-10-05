import { describe, expect, it, vi } from 'vitest'
import { CameraRig, Vector3 } from './countdownSpectator'
import {
  CameraFxPlayer,
  ChaseCamera,
  ChaseCameraOptions,
  ChaseCameraRuntimeOptions,
  VehicleTransform,
} from './chaseCamera'

function createRig(): {
  rig: CameraRig
  positions: Vector3[]
  lookAts: Vector3[]
  rolls: number[]
  fovs: number[]
} {
  const positions: Vector3[] = []
  const lookAts: Vector3[] = []
  const rolls: number[] = []
  const fovs: number[] = []
  return {
    rig: {
      //1.- Capture the latest camera position for assertions.
      setPosition(position: Vector3) {
        positions.push(position)
      },
      //2.- Capture the latest look-at vector for assertions.
      lookAt(target: Vector3) {
        lookAts.push(target)
      },
      //3.- Track applied roll angles so banking behavior can be tested.
      setRoll(value: number) {
        rolls.push(value)
      },
      //4.- Track applied FOV values to ensure speed cues run.
      setFov(value: number) {
        fovs.push(value)
      },
    },
    positions,
    lookAts,
    rolls,
    fovs,
  }
}

function createFxPlayer() {
  const playVisualFx = vi.fn()
  const playAudioFx = vi.fn()
  const player: CameraFxPlayer = {
    //1.- Forward calls to Vitest spies so we can validate invocations.
    playVisualFx: playVisualFx.mockImplementation(() => {}),
    //2.- Forward calls to Vitest spies so we can validate invocations.
    playAudioFx: playAudioFx.mockImplementation(() => {}),
  }
  return { player, playVisualFx, playAudioFx }
}

describe('ChaseCamera', () => {
  const baseOptions: ChaseCameraOptions = {
    offsets: {
      position: { x: 0, y: 3, z: -6 },
      lookAt: { x: 0, y: 1, z: 5 },
    },
    damping: {
      position: 12,
      lookAt: 10,
    },
    eventFx: {
      boost: {
        shake: { amplitude: 1.2, frequency: 6, duration: 1 },
        visualFx: 'boost_flash',
        audioFx: 'boost_whoosh',
      },
      hit: {
        shake: { amplitude: 2, frequency: 4, duration: 0.6 },
        visualFx: 'impact_flash',
        audioFx: 'impact_thud',
      },
      nearMiss: {
        shake: { amplitude: 0.8, frequency: 8, duration: 0.4 },
        visualFx: 'near_miss_glow',
        audioFx: 'near_miss_ping',
      },
      crash: {
        shake: { amplitude: 3, frequency: 5, duration: 1.4 },
        visualFx: 'crash_flash',
        audioFx: 'crash_boom',
      },
      touchdown: {
        shake: { amplitude: 1.1, frequency: 3, duration: 0.7 },
        visualFx: 'touchdown_spark',
        audioFx: 'touchdown_rumble',
      },
      ceilingBump: {
        shake: { amplitude: 1.6, frequency: 5, duration: 0.6 },
        visualFx: 'ceiling_flash',
        audioFx: 'ceiling_thud',
      },
      highG: {
        shake: { amplitude: 1.4, frequency: 7, duration: 0.9 },
        visualFx: 'highg_blur',
        audioFx: 'highg_grunt',
      },
    },
    lookAhead: {
      distance: 6,
      maxSpeed: 120,
    },
    roll: {
      followStrength: 0.35,
      damping: 14,
    },
    fov: {
      idle: 65,
      max: 80,
      maxSpeed: 120,
      boost: 4,
      damping: 10,
    },
  }

  const transform: VehicleTransform = {
    position: { x: 10, y: 1, z: 5 },
    forward: { x: 0, y: 0, z: 1 },
    up: { x: 0, y: 1, z: 0 },
    velocity: { x: 0, y: 0, z: 25 },
    speed: 25,
    boostActive: false,
  }

  it('smoothly follows the vehicle with configurable damping', () => {
    const { rig, positions, lookAts } = createRig()
    const { player } = createFxPlayer()
    const camera = new ChaseCamera(rig, player, baseOptions)

    //1.- Initialize the camera at the baseline offset.
    camera.update(0.016, transform)
    //2.- Move the vehicle forward and sample another frame to observe damping.
    const movedTransform: VehicleTransform = {
      position: { x: 10, y: 1, z: 10 },
      forward: transform.forward,
      up: transform.up,
      velocity: { x: 0, y: 0, z: 40 },
      speed: 40,
      boostActive: false,
    }
    camera.update(0.016, movedTransform)

    expect(positions.length).toBe(2)
    const firstPosition = positions[0]
    const secondPosition = positions[1]
    //3.- Confirm the second frame is in between the start and goal due to damping.
    expect(secondPosition.z).toBeGreaterThan(firstPosition.z)
    expect(secondPosition.z).toBeLessThan(4)
    const lastLookAt = lookAts[lookAts.length - 1]
    expect(lastLookAt.z).toBeGreaterThan(11)
  })

  it('leans with the craft and widens FOV when boosting', () => {
    const { rig, rolls, fovs } = createRig()
    const { player } = createFxPlayer()
    const camera = new ChaseCamera(rig, player, baseOptions)

    const banked: VehicleTransform = {
      position: transform.position,
      forward: transform.forward,
      up: { x: 0.3, y: 0.95, z: 0 },
      velocity: { x: 0, y: 0, z: 140 },
      speed: 140,
      boostActive: true,
    }

    //1.- Run multiple frames so damping settles towards the boosted targets.
    camera.update(0.016, banked)
    camera.update(0.016, banked)

    expect(rolls.some((value) => Math.abs(value) > 0)).toBe(true)
    expect(fovs[fovs.length - 1]).toBeGreaterThan(baseOptions.fov.idle)
  })

  it('applies runtime overrides for respawn or cinematic moments', () => {
    const { rig, positions } = createRig()
    const { player } = createFxPlayer()
    const camera = new ChaseCamera(rig, player, baseOptions)

    const overrides: Partial<ChaseCameraRuntimeOptions> = {
      offsets: {
        position: { x: 0, y: 10, z: -12 },
        lookAt: { x: 0, y: 2, z: 4 },
      },
      damping: {
        position: 20,
        lookAt: 18,
      },
    }

    //1.- Apply an override for a single update to confirm the effect takes hold.
    camera.update(0.016, transform, overrides)

    expect(positions[0].y).toBeGreaterThan(5)
    expect(positions[0].z).toBeLessThan(-4)
  })

  it('triggers shakes and FX cues when events fire', () => {
    const { rig, positions } = createRig()
    const { player, playAudioFx, playVisualFx } = createFxPlayer()
    const camera = new ChaseCamera(rig, player, baseOptions)

    //1.- Fire the crash event which should start a shake and trigger both FX outputs.
    camera.trigger('crash')
    camera.update(0.016, transform)
    camera.update(0.016, transform)

    expect(playVisualFx).toHaveBeenCalledWith('crash_flash')
    expect(playAudioFx).toHaveBeenCalledWith('crash_boom')
    //2.- Verify the shake displaced the camera from its base offset at least once.
    const shakenFrame = positions.find((position) => position.x !== positions[0].x)
    expect(shakenFrame).toBeDefined()
  })
})
