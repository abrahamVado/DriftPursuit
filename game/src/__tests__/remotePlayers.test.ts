import { beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { createRemotePlayerManager } from '@/engine/remotePlayers'

describe('remote player manager', () => {
  let scene: THREE.Scene

  beforeEach(() => {
    //1.- Reset the scene graph to a clean slate before each assertion.
    scene = new THREE.Scene()
  })

  it('creates and updates remote pilot meshes from vehicle diffs', () => {
    const manager = createRemotePlayerManager(scene)

    manager.ingestDiff({
      updated: [
        {
          vehicle_id: 'veh-alpha',
          position: { x: 10, y: 5, z: -2 },
          orientation: { yaw_deg: 90, pitch_deg: 15, roll_deg: 5 },
        },
      ],
    })

    const group = manager.getVehicleGroup('veh-alpha')
    expect(group).toBeDefined()
    expect(group?.position.x).toBeCloseTo(10)
    expect(group?.position.y).toBeCloseTo(5)
    expect(group?.position.z).toBeCloseTo(-2)
    expect(group?.rotation.y).toBeCloseTo(THREE.MathUtils.degToRad(90))
    expect(group?.rotation.x).toBeCloseTo(THREE.MathUtils.degToRad(15))
    expect(group?.rotation.z).toBeCloseTo(THREE.MathUtils.degToRad(5))

    manager.ingestDiff({
      updated: [
        {
          vehicle_id: 'veh-alpha',
          position: { y: 9 },
          orientation: { roll_deg: 20 },
        },
      ],
    })

    expect(group?.position.x).toBeCloseTo(10)
    expect(group?.position.y).toBeCloseTo(9)
    expect(group?.position.z).toBeCloseTo(-2)
    expect(group?.rotation.z).toBeCloseTo(THREE.MathUtils.degToRad(20))
    expect(manager.activeVehicleIds()).toEqual(['veh-alpha'])
  })

  it('removes remote pilot meshes when vehicle ids disappear', () => {
    const manager = createRemotePlayerManager(scene)

    manager.ingestDiff({
      updated: [
        {
          vehicle_id: 'veh-beta',
          position: { x: 1, y: 2, z: 3 },
        },
      ],
    })

    expect(manager.getVehicleGroup('veh-beta')).toBeDefined()

    manager.ingestDiff({ removed: ['veh-beta'] })

    expect(manager.getVehicleGroup('veh-beta')).toBeUndefined()
    expect(manager.activeVehicleIds()).toEqual([])
    expect(scene.children.some((child) => child.name === 'remote-players-root')).toBe(true)
  })
})
