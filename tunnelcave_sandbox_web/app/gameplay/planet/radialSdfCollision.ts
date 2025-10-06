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

export interface SurfaceVehicleState {
  readonly position: Vector3Like
  readonly velocity: Vector3Like
}

export interface SurfaceVehicleAdvanceOptions {
  readonly dt: number
  readonly mesh: CubedSphereMesh
  readonly field: RadialDisplacementField
  readonly classification: SurfaceClassification
  readonly configuration: PlanetConfiguration
  readonly radius: number
  readonly clearance?: number
}

export interface SurfaceVehicleAdvanceResult {
  readonly state: SurfaceVehicleState
  readonly normal: Vector3Like
  readonly clearance: number
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

export function advanceSurfaceVehicle(
  state: SurfaceVehicleState,
  options: SurfaceVehicleAdvanceOptions,
): SurfaceVehicleAdvanceResult {
  const { dt, mesh, field, classification, configuration, radius, clearance = 0 } = options
  if (!Number.isFinite(dt) || dt < 0) {
    throw new Error('dt must be a finite, non-negative number')
  }
  if (!Number.isFinite(radius) || radius < 0) {
    throw new Error('radius must be a non-negative number')
  }
  //1.- Predict the next centre position using the current velocity and timestep.
  const predicted = {
    x: state.position.x + state.velocity.x * dt,
    y: state.position.y + state.velocity.y * dt,
    z: state.position.z + state.velocity.z * dt,
  }
  let sampleSource: Vector3Like = predicted
  if (vectorLength(sampleSource) === 0) {
    const fallbackRadius = vectorLength(state.position)
    if (fallbackRadius === 0) {
      throw new Error('Surface vehicle position must not coincide with the planet origin')
    }
    sampleSource = state.position
  }
  const groundSample = sampleGroundDistance(sampleSource, mesh, field, classification)
  //2.- Clamp the radius between the displaced ground clearance and atmospheric ceiling.
  const requestedClearance = Math.max(configuration.surfaceClearance, radius + clearance)
  const targetRadius = groundSample.surfaceRadius + requestedClearance
  const maxRadius = field.baseRadius + configuration.atmosphereHeight
  const clampedRadius = Math.min(Math.max(targetRadius, 0), maxRadius)
  const normal = normaliseVector(groundSample.gradient)
  const clampedPosition = createVector(
    normal.x * clampedRadius,
    normal.y * clampedRadius,
    normal.z * clampedRadius,
  )
  //3.- Project velocity into the tangent plane so motion hugs the spherical surface.
  const normalSpeed =
    state.velocity.x * normal.x +
    state.velocity.y * normal.y +
    state.velocity.z * normal.z
  const tangentialVelocity = createVector(
    state.velocity.x - normal.x * normalSpeed,
    state.velocity.y - normal.y * normalSpeed,
    state.velocity.z - normal.z * normalSpeed,
  )
  const distance = clampedRadius - groundSample.surfaceRadius
  const clearanceToSurface = Math.max(0, distance - radius)
  const nextState: SurfaceVehicleState = Object.freeze({
    position: clampedPosition,
    velocity: tangentialVelocity,
  })
  return Object.freeze({
    state: nextState,
    normal,
    clearance: clearanceToSurface,
  })
}

