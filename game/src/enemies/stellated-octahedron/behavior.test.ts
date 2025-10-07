import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createEnemy, updateEnemies } from './behavior'
import { getDifficultyState } from '@/engine/difficulty'
import { createSpawner } from '@/spawn/spawnTable'

describe('stellated octahedron enemy', () => {
  it('builds a merged enemy mesh and registers it with the scene', () => {
    //1.- Prepare a fresh scene and create the enemy at a known position.
    const scene = new THREE.Scene()
    const enemy = createEnemy(scene, new THREE.Vector3(1, 2, 3))

    //2.- Assert the geometry merges both tetrahedra into one buffer mesh.
    expect(enemy.mesh).toBeInstanceOf(THREE.Object3D)
    const body = enemy.mesh.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh | undefined
    expect(body).toBeInstanceOf(THREE.Mesh)
    const geometry = body!.geometry as THREE.BufferGeometry
    expect(geometry.getAttribute('position').count).toBeGreaterThanOrEqual(24)

    //3.- Verify the scene registry keeps track of the created enemy and its transform.
    const tracked = (scene as any).__enemies
    expect(Array.isArray(tracked)).toBe(true)
    expect(tracked).toContain(enemy)
    expect(enemy.mesh.position.toArray()).toEqual([1, 2, 3])
  })

  it('steers towards its target when updated through the global registry', () => {
    //1.- Spawn the enemy and define a target ahead on the X axis.
    const scene = new THREE.Scene()
    const enemy = createEnemy(scene, new THREE.Vector3(0, 0, 0))
    const target = new THREE.Object3D()
    target.position.set(10, 0, 0)
    enemy.target = target

    //2.- Advance the simulation and confirm the enemy drifted towards the target.
    updateEnemies(scene, 0.5, getDifficultyState())
    expect(enemy.mesh.position.x).toBeGreaterThan(0)

    //3.- Invoke the death handler and ensure cleanup removes the mesh from the scene.
    const childCountBefore = scene.children.length
    enemy.onDeath()
    expect(scene.children.length).toBe(childCountBefore - 1)
  })

  it('uses the spawner loop to move newly spawned enemies towards the player', () => {
    //1.- Prepare the scene, player surrogate, and deterministic randomness for spawn placement.
    const scene = new THREE.Scene()
    const playerGroup = new THREE.Object3D()
    playerGroup.position.set(0, 0, 0)
    const streamer = { queryHeight: () => 0 }
    const spawner = createSpawner(scene, { group: playerGroup }, streamer)
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5)

    try {
      //2.- Run the spawner long enough to instantiate an enemy and capture its initial distance.
      spawner.update(1, 0)
      spawner.update(1, 0)
      spawner.update(1, 0)
      const enemies = (scene as any).__enemies as any[] | undefined
      expect(enemies).toBeDefined()
      expect(enemies!.length).toBeGreaterThan(0)
      const enemy = enemies![0]
      const initialDistance = enemy.mesh.position.distanceTo(playerGroup.position)

      //3.- Advance the loop again and confirm the enemy approaches the player target.
      spawner.update(0.2, 0)
      const updatedDistance = enemy.mesh.position.distanceTo(playerGroup.position)
      expect(updatedDistance).toBeLessThan(initialDistance)
    } finally {
      randomSpy.mockRestore()
    }
  })
})
