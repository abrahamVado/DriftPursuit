import type { CubedSphereMesh } from './cubedSphereMesh'
import type { RadialDisplacementField } from './noiseDisplacement'
import type { PlanetConfiguration } from './planetSpecLoader'
import type { SurfaceClassification } from './seaLevelMask'

export interface Vector3Like {
  readonly x: number
  readonly y: number
  readonly z: number
}

function createVector(x: number, y: number, z: number): Vector3Like {
  //1.- Materialise lightweight vector records that are serialisable across worker boundaries.
  return Object.freeze({ x, y, z })
}

function vectorLength(vector: Vector3Like): number {
  //1.- Compute the Euclidean magnitude without relying on Three.js helpers that may be mocked in tests.
  return Math.hypot(vector.x, vector.y, vector.z)
}

function normaliseVector(vector: Vector3Like): Vector3Like {
  //1.- Re-scale the vector into a unit direction to reuse across gradient and ground projections.
  const length = vectorLength(vector)
  if (length === 0) {
    throw new Error('Cannot normalise a zero-length vector')
  }
  return createVector(vector.x / length, vector.y / length, vector.z / length)
}

export interface GroundSample {
  readonly surfaceRadius: number
  readonly distance: number
  readonly gradient: Vector3Like
  readonly groundPoint: Vector3Like
  readonly vertexIndex: number
}

function selectNearestVertexIndex(mesh: CubedSphereMesh, direction: Vector3Like): number {
  //1.- Walk the shared vertex list and pick the direction that maximises alignment with the query.
  let bestIndex = 0
  let bestDot = -Infinity
  for (let index = 0; index < mesh.vertices.length / 3; index += 1) {
    const vx = mesh.vertices[index * 3]
    const vy = mesh.vertices[index * 3 + 1]
    const vz = mesh.vertices[index * 3 + 2]
    const dot = vx * direction.x + vy * direction.y + vz * direction.z
    if (dot > bestDot) {
      bestDot = dot
      bestIndex = index
    }
  }
  return bestIndex
}

export function sampleGroundDistance(
  position: Vector3Like,
  mesh: CubedSphereMesh,
  field: RadialDisplacementField,
  classification: SurfaceClassification
): GroundSample {
  //1.- Normalise the position into a unit direction and locate the nearest precomputed vertex.
  const radius = vectorLength(position)
  if (radius === 0) {
    throw new Error('Cannot sample ground distance from the origin')
  }
  const direction = normaliseVector(position)
  const vertexIndex = selectNearestVertexIndex(mesh, direction)
  //2.- Fetch the corresponding surface radius and derive the signed distance along the radial axis.
  const surfaceRadius = classification.surfaceRadii[vertexIndex]
  const distance = radius - surfaceRadius
  const gradient = direction
  const groundPoint = createVector(
    direction.x * surfaceRadius,
    direction.y * surfaceRadius,
    direction.z * surfaceRadius,
  )
  return {
    surfaceRadius,
    distance,
    gradient,
    groundPoint,
    vertexIndex,
  }
}

export interface AltitudeClampResult extends GroundSample {
  readonly position: Vector3Like
  readonly minRadius: number
  readonly maxRadius: number
}

export function clampVehicleAltitude(
  position: Vector3Like,
  mesh: CubedSphereMesh,
  field: RadialDisplacementField,
  classification: SurfaceClassification,
  configuration: PlanetConfiguration
): AltitudeClampResult {
  //1.- Measure the raw distance to the ground before enforcing vehicle altitude limits.
  const sample = sampleGroundDistance(position, mesh, field, classification)
  const { gradient, surfaceRadius } = sample
  const currentRadius = vectorLength(position)
  //2.- Clamp the vehicle between the ground clearance and atmospheric ceiling while preserving heading.
  const minRadius = surfaceRadius + configuration.surfaceClearance
  const maxRadius = field.baseRadius + configuration.atmosphereHeight
  const clampedRadius = Math.min(Math.max(currentRadius, minRadius), maxRadius)
  const clampedPosition = createVector(
    gradient.x * clampedRadius,
    gradient.y * clampedRadius,
    gradient.z * clampedRadius,
  )
  const distance = clampedRadius - surfaceRadius
  return {
    ...sample,
    position: clampedPosition,
    distance,
    minRadius,
    maxRadius,
  }
}

