import { describe, expect, it } from 'vitest'
import { generateCubedSphereMesh } from './cubedSphereMesh'
import type { RadialDisplacementField } from './noiseDisplacement'
import type { PlanetConfiguration } from './planetSpecLoader'
import {
  advanceSurfaceVehicle,
  clampVehicleAltitude,
  sampleGroundDistance,
  type SurfaceVehicleState,
} from './radialSdfCollision'
import { classifySurfaceBySeaLevel } from './seaLevelMask'

function createCollisionFixture(): {
  mesh: ReturnType<typeof generateCubedSphereMesh>
  field: RadialDisplacementField
  configuration: PlanetConfiguration
  classificationReturn: ReturnType<typeof classifySurfaceBySeaLevel>
  baseRadius: number
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
  return { mesh, field, configuration, classificationReturn, baseRadius }
}

function vectorLength3(vector: { readonly x: number; readonly y: number; readonly z: number }): number {
  //1.- Provide a compact norm helper so the tests stay focused on behavioural assertions.
  return Math.hypot(vector.x, vector.y, vector.z)
}

function normalise(vector: { readonly x: number; readonly y: number; readonly z: number }) {
  //1.- Normalise direction vectors for initial state setup and final assertions.
  const length = vectorLength3(vector)
  if (length === 0) {
    return { x: 0, y: 0, z: 0 }
  }
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length }
}

function scaleVector(vector: { readonly x: number; readonly y: number; readonly z: number }, scale: number) {
  //1.- Multiply a vector by a scalar so waypoint construction stays declarative.
  return { x: vector.x * scale, y: vector.y * scale, z: vector.z * scale }
}

function cross(a: { readonly x: number; readonly y: number; readonly z: number }, b: {
  readonly x: number
  readonly y: number
  readonly z: number
}) {
  //1.- Cross product helper used to derive tangent directions for the traversal loop.
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function dot(a: { readonly x: number; readonly y: number; readonly z: number }, b: {
  readonly x: number
  readonly y: number
  readonly z: number
}): number {
  //1.- Compute vector agreement to ensure tangential velocity remains orthogonal to the surface normal.
  return a.x * b.x + a.y * b.y + a.z * b.z
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

describe('advanceSurfaceVehicle', () => {
  it('projects motion along great-circle tangents while preserving clearance', () => {
    //1.- Set up a surface vehicle with tangential velocity on the equatorial band.
    const { mesh, field, classificationReturn, configuration, baseRadius } = createCollisionFixture()
    const startDirection = normalise({ x: 0.85, y: 0.2, z: 0.1 })
    const startRadius = baseRadius + configuration.surfaceClearance
    const spinAxis = normalise({ x: 0.0, y: 1.0, z: 0.25 })
    let tangent = cross(spinAxis, startDirection)
    if (vectorLength3(tangent) === 0) {
      tangent = cross({ x: 0.3, y: 0.0, z: 1.0 }, startDirection)
    }
    const tangentDirection = normalise(tangent)
    let state: SurfaceVehicleState = {
      position: scaleVector(startDirection, startRadius),
      velocity: scaleVector(tangentDirection, 90),
    }
    const steps = 180
    const dt = 0.05
    for (let index = 0; index < steps; index += 1) {
      const result = advanceSurfaceVehicle(state, {
        dt,
        mesh,
        field,
        classification: classificationReturn,
        configuration,
        radius: 0,
      })
      //2.- Verify the vehicle remains glued to the spherical shell and travels along tangents.
      const radiusDelta = Math.abs(vectorLength3(result.state.position) - startRadius)
      expect(radiusDelta).toBeLessThan(0.35)
      expect(Math.abs(dot(result.state.velocity, result.normal))).toBeLessThan(1e-3)
      const clearanceDelta = Math.abs(result.clearance - configuration.surfaceClearance)
      expect(clearanceDelta).toBeLessThan(0.35)
      state = result.state
    }
    //3.- Confirm the traversal wraps around the sphere instead of remaining in a flat plane.
    const finalDirection = normalise(state.position)
    expect(Math.abs(finalDirection.z)).toBeGreaterThan(0.05)
  })

  it('honours requested clearance overrides beyond the baseline configuration', () => {
    //1.- Increase the clearance requirement and ensure the clamp respects the larger hull footprint.
    const { mesh, field, classificationReturn, configuration, baseRadius } = createCollisionFixture()
    const direction = normalise({ x: -0.4, y: 0.5, z: 0.75 })
    const radius = 2
    const extraClearance = 4
    const requested = Math.max(configuration.surfaceClearance, radius + extraClearance)
    let state: SurfaceVehicleState = {
      position: scaleVector(direction, baseRadius + requested),
      velocity: { x: 0, y: 0, z: 0 },
    }
    const result = advanceSurfaceVehicle(state, {
      dt: 0.016,
      mesh,
      field,
      classification: classificationReturn,
      configuration,
      radius,
      clearance: extraClearance,
    })
    //2.- Validate the centre radius reflects the override and reports the residual hull clearance.
    expect(vectorLength3(result.state.position)).toBeCloseTo(baseRadius + requested, 6)
    expect(result.clearance).toBeCloseTo(requested - radius, 6)
  })
})

