import { describe, expect, it, vi } from 'vitest'
import type { SpyInstance } from 'vitest'
import * as THREE from 'three'

import { createEnemy, updateEnemies } from './behavior'

describe('stellated octahedron enemy', () => {
  it('registers the enemy in the scene and tracks position updates', () => {
    const scene = new THREE.Scene()
    const position = new THREE.Vector3(1, 2, 3)
    const enemy = createEnemy(scene, position.clone())

    expect(enemy.mesh.position.clone().toArray()).toEqual(position.toArray())
    expect(scene.children).toContain(enemy.mesh)
    expect(((scene as any).__enemies as unknown[]).includes(enemy)).toBe(true)

    enemy.target = new THREE.Object3D()
    enemy.target.position.set(100, 2, 3)
    const before = enemy.mesh.position.clone()
    updateEnemies(scene, 0.1)

    expect(enemy.mesh.position.x).toBeGreaterThan(before.x)
  })

  it('cleans up mesh resources on death', () => {
    const scene = new THREE.Scene()
    const enemy = createEnemy(scene, new THREE.Vector3())
    const geometrySpies: SpyInstance[] = []
    const materialSpies: SpyInstance[] = []

    for (const child of enemy.mesh.children) {
      if (child instanceof THREE.Mesh) {
        const geoSpy = vi.spyOn(child.geometry, 'dispose')
        geometrySpies.push(geoSpy)

        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => {
            if (!mat.dispose) return
            materialSpies.push(vi.spyOn(mat, 'dispose'))
          })
        } else if (child.material.dispose) {
          materialSpies.push(vi.spyOn(child.material, 'dispose'))
        }
      }
    }

    enemy.onDeath()

    expect(scene.children).not.toContain(enemy.mesh)
    expect(geometrySpies.length).toBeGreaterThan(0)
    expect(geometrySpies.some((spy) => spy.mock.calls.length > 0)).toBe(true)
    expect(materialSpies.length).toBeGreaterThan(0)
    expect(materialSpies.every((spy) => spy.mock.calls.length > 0)).toBe(true)
  })
})
