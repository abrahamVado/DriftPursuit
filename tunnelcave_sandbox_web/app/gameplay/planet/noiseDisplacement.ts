import * as THREE from 'three'
import type { CubedSphereMesh } from './cubedSphereMesh'
import type { PlanetConfiguration, PlanetNoiseLayer } from './planetSpecLoader'

export interface RadialDisplacementField {
  readonly baseRadius: number
  readonly radii: Float32Array
  readonly displacements: Float32Array
  readonly positions: Float32Array
}

function hash3(seed: number, x: number, y: number, z: number): number {
  //1.- Combine integer lattice coordinates with the seed via large primes to decorrelate axes.
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ seed
  value = (value ^ (value >>> 13)) >>> 0
  value = Math.imul(value, 1274126177)
  value = (value ^ (value >>> 16)) >>> 0
  return value / 4294967295
}

function smoothStep(t: number): number {
  //1.- Apply the cubic smoothing curve used by classic Perlin noise for continuous gradients.
  return t * t * (3 - 2 * t)
}

function valueNoise3D(seed: number, x: number, y: number, z: number): number {
  //1.- Identify the surrounding unit cube and fetch pseudo-random values for each corner.
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const z0 = Math.floor(z)
  const xf = x - x0
  const yf = y - y0
  const zf = z - z0
  const x1 = x0 + 1
  const y1 = y0 + 1
  const z1 = z0 + 1
  const v000 = hash3(seed, x0, y0, z0)
  const v100 = hash3(seed, x1, y0, z0)
  const v010 = hash3(seed, x0, y1, z0)
  const v110 = hash3(seed, x1, y1, z0)
  const v001 = hash3(seed, x0, y0, z1)
  const v101 = hash3(seed, x1, y0, z1)
  const v011 = hash3(seed, x0, y1, z1)
  const v111 = hash3(seed, x1, y1, z1)
  //2.- Interpolate along each axis using the smoothed fractional offsets to preserve continuity.
  const sx = smoothStep(xf)
  const sy = smoothStep(yf)
  const sz = smoothStep(zf)
  const i00 = v000 + (v100 - v000) * sx
  const i10 = v010 + (v110 - v010) * sx
  const i01 = v001 + (v101 - v001) * sx
  const i11 = v011 + (v111 - v011) * sx
  const j0 = i00 + (i10 - i00) * sy
  const j1 = i01 + (i11 - i01) * sy
  return j0 + (j1 - j0) * sz
}

function fbmNoise(seed: number, direction: THREE.Vector3, layers: readonly PlanetNoiseLayer[]): number {
  //1.- Accumulate centred value noise contributions for each configured layer.
  let total = 0
  layers.forEach((layer, index) => {
    const frequency = layer.frequency
    const amplitude = layer.amplitude
    const offsetSeed = seed + index * 1013904223
    const sample = valueNoise3D(
      offsetSeed,
      direction.x * frequency,
      direction.y * frequency,
      direction.z * frequency,
    )
    total += (sample * 2 - 1) * amplitude
  })
  return total
}

function determineBaseRadius(configuration: PlanetConfiguration): number {
  //1.- Extract the largest configured radius so the displacement expands upon the outer shell.
  let base = -Infinity
  configuration.radii.forEach((radius) => {
    if (radius > base) {
      base = radius
    }
  })
  if (!Number.isFinite(base)) {
    throw new Error('Planet configuration must define at least one radius value')
  }
  return base
}

export function applyNoiseDisplacement(
  mesh: CubedSphereMesh,
  configuration: PlanetConfiguration,
): RadialDisplacementField {
  //1.- Resolve the base radius and allocate typed buffers for the radial field and displaced geometry.
  const baseRadius = determineBaseRadius(configuration)
  const vertexCount = mesh.vertices.length / 3
  const radii = new Float32Array(vertexCount)
  const displacements = new Float32Array(vertexCount)
  const positions = new Float32Array(mesh.vertices.length)
  //2.- Reuse a shared direction vector to avoid heap churn inside the tight vertex loop.
  const direction = new THREE.Vector3()
  for (let index = 0; index < vertexCount; index += 1) {
    const x = mesh.vertices[index * 3]
    const y = mesh.vertices[index * 3 + 1]
    const z = mesh.vertices[index * 3 + 2]
    direction.set(x, y, z)
    const displacement = fbmNoise(configuration.seed, direction, configuration.noiseLayers)
    const radius = baseRadius + displacement
    radii[index] = radius
    displacements[index] = displacement
    positions[index * 3] = direction.x * radius
    positions[index * 3 + 1] = direction.y * radius
    positions[index * 3 + 2] = direction.z * radius
  }
  const field: RadialDisplacementField = {
    baseRadius,
    radii,
    displacements,
    positions,
  }
  return Object.freeze(field)
}

