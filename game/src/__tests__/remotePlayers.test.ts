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

    //1.- Inject the authoritative snapshot that spawns the remote pilot with its metadata and transform.
    manager.ingestDiff({
      updated: [
        {
          vehicle_id: 'veh-alpha',
          position: { x: 10, y: 5, z: -2 },
          orientation: { yaw_deg: 90, pitch_deg: 15, roll_deg: 5 },
          profile: { name: 'Nova Prime', vehicle: 'icosahedron' },
        },
      ],
    })

    const group = manager.getVehicleGroup('veh-alpha')
    expect(group).toBeDefined()
    expect(group?.userData.remoteProfile).toEqual({ pilotName: 'Nova Prime', vehicleKey: 'icosahedron' })
    expect(group?.name).toBe('remote-player:Nova Prime (icosahedron)')
    expect(group?.children.some((child) => child.name === 'remote-vehicle-icosahedron')).toBe(true)

    expect(group?.position.x).toBeCloseTo(10)
    expect(group?.position.y).toBeCloseTo(5)
    expect(group?.position.z).toBeCloseTo(-2)
    expect(group?.rotation.y).toBeCloseTo(THREE.MathUtils.degToRad(90))
    expect(group?.rotation.x).toBeCloseTo(THREE.MathUtils.degToRad(15))
    expect(group?.rotation.z).toBeCloseTo(THREE.MathUtils.degToRad(5))

    //2.- Apply a follow-up diff to verify incremental transform updates reuse the existing group.
    manager.ingestDiff({
      updated: [
        {
          vehicle_id: 'veh-alpha',
          position: { y: 9 },
          orientation: { roll_deg: 20 },
          profile: { name: 'Nova Prime', vehicle: 'icosahedron' },
        },
      ],
    })

    expect(group?.position.x).toBeCloseTo(10)
    expect(group?.position.y).toBeCloseTo(9)
    expect(group?.position.z).toBeCloseTo(-2)
    expect(group?.rotation.z).toBeCloseTo(THREE.MathUtils.degToRad(20))
    expect(manager.activeVehicleIds()).toEqual(['veh-alpha'])
  })

  it('refreshes vehicle meshes and nameplates when pilot metadata changes', () => {
    const manager = createRemotePlayerManager(scene)

    //1.- Spawn the initial remote pilot using the arrowhead chassis and placeholder identity.
    manager.ingestDiff({
      updated: [
        {
          vehicle_id: 'veh-meta',
          profile: { name: 'Rookie', vehicle: 'arrowhead' },
        },
      ],
    })

    const group = manager.getVehicleGroup('veh-meta')
    expect(group).toBeDefined()
    expect(group?.children.some((child) => child.name === 'remote-vehicle-arrowhead')).toBe(true)

    //2.- Deliver a metadata update that swaps both the pilot name and the selected vehicle.
    manager.ingestDiff({
      updated: [
        {
          vehicle_id: 'veh-meta',
          profile: { name: 'Ace Pilot', vehicle: 'cube' },
        },
      ],
    })

    expect(group?.userData.remoteProfile).toEqual({ pilotName: 'Ace Pilot', vehicleKey: 'cube' })
    expect(group?.name).toBe('remote-player:Ace Pilot (cube)')
    expect(group?.children.some((child) => child.name === 'remote-vehicle-cube')).toBe(true)
    expect(group?.children.some((child) => child.name === 'remote-vehicle-arrowhead')).toBe(false)
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
