import { describe, expect, it } from 'vitest'
import { generateCubedSphereMesh } from './cubedSphereMesh'
import type { RadialDisplacementField } from './noiseDisplacement'
import type { PlanetConfiguration } from './planetSpecLoader'
import { classifySurfaceBySeaLevel } from './seaLevelMask'

function createTestField(): { field: RadialDisplacementField; configuration: PlanetConfiguration } {
  //1.- Build a compact cubed-sphere mesh to derive deterministic vertex positions.
  const mesh = generateCubedSphereMesh(1)
  const vertexCount = mesh.vertices.length / 3
  const radii = new Float32Array(vertexCount)
  const displacements = new Float32Array(vertexCount)
  const positions = new Float32Array(mesh.vertices.length)
  const baseRadius = 110
  for (let index = 0; index < vertexCount; index += 1) {
    const baseX = mesh.vertices[index * 3]
    const baseY = mesh.vertices[index * 3 + 1]
    const baseZ = mesh.vertices[index * 3 + 2]
    const radius = index % 2 === 0 ? 95 : 120
    radii[index] = radius
    displacements[index] = radius - baseRadius
    positions[index * 3] = baseX * radius
    positions[index * 3 + 1] = baseY * radius
    positions[index * 3 + 2] = baseZ * radius
  }
  const field: RadialDisplacementField = Object.freeze({
    baseRadius,
    radii,
    displacements,
    positions,
  })
  const configuration: PlanetConfiguration = {
    seed: 1,
    radii: Object.freeze([80, baseRadius]),
    noiseLayers: Object.freeze([]),
    lodThresholds: Object.freeze([0.1]),
    seaLevel: 100,
    surfaceClearance: 2,
    atmosphereHeight: 50,
  }
  return { field, configuration }
}

describe('classifySurfaceBySeaLevel', () => {
  it('produces ocean masks for vertices below the configured sea level', () => {
    //1.- Prepare a radial field with alternating above/below sea level radii.
    const { field, configuration } = createTestField()
    const classification = classifySurfaceBySeaLevel(field, configuration)
    //2.- Validate mask counts and confirm sea-level clamping for ocean vertices.
    expect(classification.seaLevel).toBe(100)
    expect(classification.oceanVertexCount).toBeGreaterThan(0)
    expect(classification.oceanVertexCount + classification.landVertexCount).toBe(
      field.radii.length
    )
    for (let index = 0; index < field.radii.length; index += 1) {
      if (field.radii[index] <= 100) {
        expect(classification.oceanMask[index]).toBe(1)
        expect(classification.surfaceRadii[index]).toBe(100)
      } else {
        expect(classification.oceanMask[index]).toBe(0)
        expect(classification.surfaceRadii[index]).toBe(field.radii[index])
      }
    }
  })

  it('returns immutable buffers sized to the radial field', () => {
    //1.- Reuse the shared fixture and ensure the returned structure is frozen for thread safety.
    const { field, configuration } = createTestField()
    const classification = classifySurfaceBySeaLevel(field, configuration)
    expect(classification.surfaceRadii.length).toBe(field.radii.length)
    expect(classification.oceanMask.length).toBe(field.radii.length)
    expect(Object.isFrozen(classification)).toBe(true)
  })
})

