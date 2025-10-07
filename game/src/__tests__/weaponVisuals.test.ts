import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createNeonLaserVisual } from '@/weapons/visuals/neonLaserVisual'
import { createHomingMissileVisual } from '@/weapons/visuals/homingMissileVisual'
import type { NeonLaserState } from '@/weapons/neonLaser'
import type { HomingMissileState } from '@/weapons/homingMissile'

describe('neon laser visual', () => {
  it('aligns the beam mesh with the laser state', () => {
    const scene = new THREE.Scene()
    const visual = createNeonLaserVisual(scene)

    const state: NeonLaserState = {
      active: true,
      remainingMs: 0,
      cooldownMs: 0,
      origin: new THREE.Vector3(10, 4, -2),
      direction: new THREE.Vector3(0.2, -0.1, -1),
      length: 120,
      intensity: 0.8,
    }

    //1.- Feed the renderer with an active beam so orientation, position, and scale can be asserted.
    visual.update(state)

    expect(visual.beam.visible).toBe(true)
    expect(visual.beam.scale.z).toBeCloseTo(state.length)

    const expectedDirection = state.direction.clone().normalize()
    const expectedPosition = state.origin.clone().addScaledVector(expectedDirection, state.length * 0.5)

    expect(visual.beam.position.distanceTo(expectedPosition)).toBeLessThan(1e-6)

    const oriented = new THREE.Vector3(0, 0, 1).applyQuaternion(visual.beam.quaternion)
    expect(oriented.distanceTo(expectedDirection)).toBeLessThan(1e-6)

    visual.dispose()
  })

  it('hides the beam when inactive', () => {
    const scene = new THREE.Scene()
    const visual = createNeonLaserVisual(scene)

    const state: NeonLaserState = {
      active: false,
      remainingMs: 0,
      cooldownMs: 0,
      origin: new THREE.Vector3(),
      direction: new THREE.Vector3(0, 0, -1),
      length: 0,
      intensity: 0,
    }

    visual.update(state)

    expect(visual.beam.visible).toBe(false)

    visual.dispose()
  })
})

describe('homing missile visual', () => {
  it('spawns and updates missile meshes for active projectiles', () => {
    const scene = new THREE.Scene()
    const visual = createHomingMissileVisual(scene)

    const missile: HomingMissileState = {
      id: 1,
      position: new THREE.Vector3(-4, 6, -20),
      velocity: new THREE.Vector3(0, -2, -150),
      targetId: 'target-1',
      lifetimeMs: 0,
      smokeTrail: [
        new THREE.Vector3(-4, 6, -20),
        new THREE.Vector3(-4, 5.5, -19),
      ],
      smokeAccumulatorMs: 0,
    }

    //2.- Sync one simulated missile so a mesh and contrail are produced for verification.
    visual.update([missile])

    expect(visual.group.children.length).toBeGreaterThan(0)
    const missileMesh = visual.group.children[0] as THREE.Object3D
    expect(missileMesh.position.distanceTo(missile.position)).toBeLessThan(1e-6)

    const oriented = new THREE.Vector3(0, 0, 1).applyQuaternion(missileMesh.quaternion)
    const expectedDirection = missile.velocity.clone().normalize()
    expect(oriented.distanceTo(expectedDirection)).toBeLessThan(1e-6)

    const trail = missileMesh.children.find(child => child instanceof THREE.Line) as THREE.Line | undefined
    expect(trail).toBeDefined()
    const trailGeometry = trail?.geometry as THREE.BufferGeometry
    expect(trailGeometry.getAttribute('position').count).toBe(missile.smokeTrail.length)

    visual.update([])
    expect(visual.group.children.length).toBe(0)

    visual.dispose()
  })
})
