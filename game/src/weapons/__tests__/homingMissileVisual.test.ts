import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createHomingMissileVisual } from '@/weapons/visuals/homingMissileVisual'

describe('homingMissileVisual', () => {
  it('scales pooled missile meshes to 1.2', () => {
    //1.- Build a scene and invoke the factory so we can inspect the pooled instances.
    const scene = new THREE.Scene()
    const visual = createHomingMissileVisual(scene)

    //2.- Feed a minimal missile state so the visual system instantiates one pooled mesh.
    visual.update([
      {
        id: 1,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(0, 0, 1),
        smokeTrail: [],
        targetId: null,
        lifetimeMs: 0,
        smokeAccumulatorMs: 0,
        stage: 'ejecting',
        stageMs: 0,
      } as any,
    ])

    //3.- Confirm the pooled mesh was uniformly scaled by 20% as part of its construction.
    const missileMesh = visual.group.children[0]
    expect(missileMesh.scale.x).toBeCloseTo(1.2)
    expect(missileMesh.scale.y).toBeCloseTo(1.2)
    expect(missileMesh.scale.z).toBeCloseTo(1.2)
  })
})
