import { describe, expect, it } from 'vitest'
import { CameraRig, CountdownSpectatorCamera, CountdownCameraOptions } from './countdownSpectator'

describe('CountdownSpectatorCamera', () => {
  it('maintains an orbit while the countdown is active', () => {
    //1.- Capture rig updates so assertions can validate the orbital path.
    const positions: { x: number; y: number; z: number }[] = []
    const targets: { x: number; y: number; z: number }[] = []
    const rig: CameraRig = {
      setPosition(position) {
        positions.push(position)
      },
      lookAt(target) {
        targets.push(target)
      },
    }
    const options: CountdownCameraOptions = {
      orbitRadius: 5,
      orbitHeight: 2,
      rotationSpeed: Math.PI,
      focus: { x: 1, y: 0, z: -3 },
    }
    const camera = new CountdownSpectatorCamera(rig, options)
    //2.- Step the camera twice to sample the orbit at two distinct angles.
    camera.update(0.5, 3)
    camera.update(0.5, 2.5)
    expect(positions).toHaveLength(2)
    expect(targets).toEqual([options.focus, options.focus])
    //3.- Confirm the first sample lines up with the configured orbit height and radius.
    const first = positions[0]
    expect(first.y).toBeCloseTo(options.focus.y + options.orbitHeight)
    const dx = first.x - options.focus.x
    const dz = first.z - options.focus.z
    expect(Math.hypot(dx, dz)).toBeCloseTo(options.orbitRadius)
  })

  it('does not move the camera once the countdown completes', () => {
    //1.- Use a rig spy to detect any updates after the countdown reaches zero.
    let moved = false
    const rig: CameraRig = {
      setPosition() {
        moved = true
      },
      lookAt() {
        moved = true
      },
    }
    const camera = new CountdownSpectatorCamera(rig, {
      orbitRadius: 5,
      orbitHeight: 2,
      rotationSpeed: 1,
      focus: { x: 0, y: 0, z: 0 },
    })
    camera.update(0.1, 0)
    expect(moved).toBe(false)
  })
})
