import { describe, expect, it } from 'vitest'
import { generateCubedSphereMesh } from './cubedSphereMesh'
import type { RadialDisplacementField } from './noiseDisplacement'
import type { PlanetConfiguration } from './planetSpecLoader'
import { clampVehicleAltitude, sampleGroundDistance } from './radialSdfCollision'
import { classifySurfaceBySeaLevel } from './seaLevelMask'

function createCollisionFixture(): {
  mesh: ReturnType<typeof generateCubedSphereMesh>
  field: RadialDisplacementField
  configuration: PlanetConfiguration
  classificationReturn: ReturnType<typeof classifySurfaceBySeaLevel>
} {
  //1.- Start from a unit cube sphere and inflate vertices to a uniform planetary radius.
  const mesh = generateCubedSphereMesh(2)
  const vertexCount = mesh.vertices.length / 3
  const baseRadius = 100
  const radii = new Float32Array(vertexCount)
  const displacements = new Float32Array(vertexCount)
  const positions = new Float32Array(mesh.vertices.length)
  for (let index = 0; index < vertexCount; index += 1) {
    radii[index] = baseRadius
    displacements[index] = 0
    const x = mesh.vertices[index * 3]
    const y = mesh.vertices[index * 3 + 1]
    const z = mesh.vertices[index * 3 + 2]
    positions[index * 3] = x * baseRadius
    positions[index * 3 + 1] = y * baseRadius
    positions[index * 3 + 2] = z * baseRadius
  }
  const field: RadialDisplacementField = Object.freeze({
    baseRadius,
    radii,
    displacements,
    positions,
  })
  const configuration: PlanetConfiguration = {
    seed: 0,
    radii: Object.freeze([baseRadius]),
    noiseLayers: Object.freeze([]),
    lodThresholds: Object.freeze([0.1]),
    seaLevel: 90,
    surfaceClearance: 5,
    atmosphereHeight: 40,
  }
  const classificationReturn = classifySurfaceBySeaLevel(field, configuration)
  return { mesh, field, configuration, classificationReturn }
}

describe('sampleGroundDistance', () => {
  it('returns radial distance and gradient aligned with the query direction', () => {
    //1.- Measure a point offset from the ground surface along the positive X axis.
    const { mesh, field, classificationReturn } = createCollisionFixture()
    const position = { x: 120, y: 0, z: 0 }
    const sample = sampleGroundDistance(position, mesh, field, classificationReturn)
    //2.- Confirm the distance matches the analytic difference and the gradient remains normalised.
    expect(sample.surfaceRadius).toBe(100)
    expect(sample.distance).toBeCloseTo(20, 6)
    expect(Math.hypot(sample.gradient.x, sample.gradient.y, sample.gradient.z)).toBeCloseTo(1, 6)
    expect(Math.hypot(sample.groundPoint.x, sample.groundPoint.y, sample.groundPoint.z)).toBeCloseTo(100, 6)
  })
})

describe('clampVehicleAltitude', () => {
  it('enforces the configured clearance above the surface', () => {
    //1.- Position the vehicle within the forbidden clearance band and clamp it outward.
    const { mesh, field, classificationReturn, configuration } = createCollisionFixture()
    const position = { x: 102, y: 0, z: 0 }
    const result = clampVehicleAltitude(position, mesh, field, classificationReturn, configuration)
    //2.- Ensure the new radius honours the clearance while reporting updated SDF distance.
    expect(Math.hypot(result.position.x, result.position.y, result.position.z)).toBeCloseTo(105, 6)
    expect(result.distance).toBeCloseTo(5, 6)
    expect(result.minRadius).toBeCloseTo(105, 6)
    expect(result.maxRadius).toBeCloseTo(140, 6)
  })

  it('caps altitude at the atmospheric ceiling', () => {
    //1.- Push the sample beyond the permitted orbit and check the clamp uses the ceiling radius.
    const { mesh, field, classificationReturn, configuration } = createCollisionFixture()
    const position = { x: 0, y: 0, z: 180 }
    const result = clampVehicleAltitude(position, mesh, field, classificationReturn, configuration)
    //2.- Validate the radius equals the base radius plus atmosphere height and preserves heading.
    expect(Math.hypot(result.position.x, result.position.y, result.position.z)).toBeCloseTo(140, 6)
    expect(result.distance).toBeCloseTo(40, 6)
    expect(result.gradient.x).toBeCloseTo(0, 6)
    expect(result.gradient.z).toBeGreaterThan(0)
  })
})

