import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createEnemy, updateEnemies } from './behavior'

describe('stellated octahedron enemy', () => {
  it('builds a grouped enemy mesh and registers it with the scene', () => {
    //1.- Prepare a fresh scene and create the enemy at a known position.
    const scene = new THREE.Scene()
    const enemy = createEnemy(scene, new THREE.Vector3(1, 2, 3))

    //2.- Assert the mesh is composed of two tetrahedron meshes grouped together.
    expect(enemy.mesh).toBeInstanceOf(THREE.Group)
    expect(enemy.mesh.children).toHaveLength(2)
    for (const child of enemy.mesh.children){
      expect(child).toBeInstanceOf(THREE.Mesh)
      const geometry = (child as THREE.Mesh).geometry
      expect(geometry).toBeInstanceOf(THREE.TetrahedronGeometry)
    }

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
    updateEnemies(scene, 0.5)
    expect(enemy.mesh.position.x).toBeGreaterThan(0)

    //3.- Invoke the death handler and ensure cleanup removes the mesh from the scene.
    const childCountBefore = scene.children.length
    enemy.onDeath()
    expect(scene.children.length).toBe(childCountBefore - 1)
  })
})
