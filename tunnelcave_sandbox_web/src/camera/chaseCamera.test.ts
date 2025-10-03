import { describe, expect, it, vi } from 'vitest'
import { CameraRig, Vector3 } from './countdownSpectator'
import {
  CameraFxPlayer,
  ChaseCamera,
  ChaseCameraOptions,
  ChaseCameraRuntimeOptions,
  VehicleTransform,
} from './chaseCamera'

function createRig(): { rig: CameraRig; positions: Vector3[]; lookAts: Vector3[] } {
  const positions: Vector3[] = []
  const lookAts: Vector3[] = []
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
    },
    positions,
    lookAts,
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
    },
  }

  const transform: VehicleTransform = {
    position: { x: 10, y: 1, z: 5 },
    forward: { x: 0, y: 0, z: 1 },
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
    }
    camera.update(0.016, movedTransform)

    expect(positions.length).toBe(2)
    const firstPosition = positions[0]
    const secondPosition = positions[1]
    //3.- Confirm the second frame is in between the start and goal due to damping.
    expect(secondPosition.z).toBeGreaterThan(firstPosition.z)
    expect(secondPosition.z).toBeLessThan(4)
    const lastLookAt = lookAts[lookAts.length - 1]
    expect(lastLookAt.z).toBeGreaterThan(9)
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

    //1.- Fire the hit event which should start a shake and trigger both FX outputs.
    camera.trigger('hit')
    camera.update(0.016, transform)
    camera.update(0.016, transform)

    expect(playVisualFx).toHaveBeenCalledWith('impact_flash')
    expect(playAudioFx).toHaveBeenCalledWith('impact_thud')
    //2.- Verify the shake displaced the camera from its base offset at least once.
    const shakenFrame = positions.find((position) => position.x !== positions[0].x)
    expect(shakenFrame).toBeDefined()
  })
})
