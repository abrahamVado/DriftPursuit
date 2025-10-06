import { describe, expect, it } from 'vitest'
import { createFixedCubedSphereLods, generateCubedSphereMesh } from './cubedSphereMesh'
import { applyNoiseDisplacement } from './noiseDisplacement'
import type { PlanetConfiguration } from './planetSpecLoader'

describe('applyNoiseDisplacement', () => {
  it('scales unit sphere vertices by the base radius when amplitudes are zero', () => {
    //1.- Assemble a coarse cubed-sphere mesh with deterministic noise layers of zero amplitude.
    const mesh = generateCubedSphereMesh(2)
    const configuration: PlanetConfiguration = {
      seed: 1234,
      radii: Object.freeze([90, 120]),
      noiseLayers: Object.freeze([
        Object.freeze({ frequency: 0.5, amplitude: 0 }),
        Object.freeze({ frequency: 1.0, amplitude: 0 }),
      ]),
      lodThresholds: Object.freeze([0.1]),
    }
    //2.- Evaluate the displacement field and verify each vertex simply scales by the maximum radius.
    const field = applyNoiseDisplacement(mesh, configuration)
    expect(field.baseRadius).toBe(120)
    for (let index = 0; index < mesh.vertices.length / 3; index += 1) {
      const radius = field.radii[index]
      expect(radius).toBeCloseTo(120, 6)
      const x = mesh.vertices[index * 3] * 120
      const y = mesh.vertices[index * 3 + 1] * 120
      const z = mesh.vertices[index * 3 + 2] * 120
      expect(field.positions[index * 3]).toBeCloseTo(x, 5)
      expect(field.positions[index * 3 + 1]).toBeCloseTo(y, 5)
      expect(field.positions[index * 3 + 2]).toBeCloseTo(z, 5)
    }
  })

  it('applies deterministic FBM noise to produce varying displacements', () => {
    //1.- Generate a moderately tessellated mesh and enable non-zero amplitudes for layered FBM sampling.
    const mesh = generateCubedSphereMesh(3)
    const configuration: PlanetConfiguration = {
      seed: 98765,
      radii: Object.freeze([150, 180, 210]),
      noiseLayers: Object.freeze([
        Object.freeze({ frequency: 0.75, amplitude: 6 }),
        Object.freeze({ frequency: 1.5, amplitude: 3 }),
      ]),
      lodThresholds: Object.freeze([0.1, 0.05]),
    }
    //2.- Compute the displacement field and confirm the output varies while remaining stable across calls.
    const fieldA = applyNoiseDisplacement(mesh, configuration)
    const fieldB = applyNoiseDisplacement(mesh, configuration)
    expect(fieldA.baseRadius).toBe(210)
    expect(fieldA.baseRadius).toBe(fieldB.baseRadius)
    let uniqueDisplacements = 0
    for (let index = 0; index < fieldA.displacements.length; index += 1) {
      const displacementA = fieldA.displacements[index]
      const displacementB = fieldB.displacements[index]
      expect(displacementA).toBeCloseTo(displacementB, 6)
      if (Math.abs(displacementA) > 1e-6) {
        uniqueDisplacements += 1
      }
      const expectedRadius = 210 + displacementA
      expect(fieldA.radii[index]).toBeCloseTo(expectedRadius, 4)
    }
    expect(uniqueDisplacements).toBeGreaterThan(0)
  })

  it('shares LOD meshes while producing displacement buffers per vertex', () => {
    //1.- Build a bundle of shared cubed-sphere LOD meshes and apply the displacement to one level.
    const lods = createFixedCubedSphereLods([0, 1])
    const mesh = lods[1]
    const configuration: PlanetConfiguration = {
      seed: 222,
      radii: Object.freeze([50, 55, 62]),
      noiseLayers: Object.freeze([Object.freeze({ frequency: 0.4, amplitude: 2.5 })]),
      lodThresholds: Object.freeze([0.2]),
    }
    //2.- Verify the displacement output exposes immutable typed arrays sized to the vertex count.
    const field = applyNoiseDisplacement(mesh, configuration)
    expect(field.positions.length).toBe(mesh.vertices.length)
    expect(field.radii.length).toBe(mesh.vertices.length / 3)
    expect(field.displacements.length).toBe(mesh.vertices.length / 3)
    expect(Object.isFrozen(field)).toBe(true)
  })
})

