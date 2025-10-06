import * as THREE from 'three'

export interface FlightTileIndex {
  x: number
  z: number
}

export interface FlightTileMetrics {
  minHeight: number
  maxHeight: number
  averageHeight: number
}

export interface FlightTile {
  id: string
  index: FlightTileIndex
  origin: { x: number; z: number }
  size: number
  resolution: number
  heights: Float32Array
  normals: Float32Array
  metrics: FlightTileMetrics
}

export interface InfiniteFlightFieldOptions {
  seed?: number
  tileSize?: number
  resolution?: number
  viewDistance?: number
  onTileLoaded?: (tile: FlightTile) => void
  onTileUnloaded?: (tile: FlightTile) => void
}

interface GeneratedTile {
  tile: FlightTile
  heightGrid: number[][]
}

const DEFAULT_TILE_SIZE = 320
const DEFAULT_RESOLUTION = 33
const DEFAULT_VIEW_DISTANCE = 1
const MIN_RESOLUTION = 5

function tileKey(index: FlightTileIndex): string {
  //1.- Compose a deterministic string key so tile storage stays map friendly.
  return `${index.x}:${index.z}`
}

function sampleHeight(seed: number, worldX: number, worldZ: number): number {
  //1.- Blend several trigonometric layers to provide deterministic pseudo-random terrain undulation.
  const nx = worldX * 0.0031 + seed * 0.0002
  const nz = worldZ * 0.0027 - seed * 0.00015
  const ridge = Math.sin(nx * 1.4 + Math.cos(nz * 0.6)) * Math.cos(nz * 1.1 + seed * 0.0013)
  const dunes = Math.sin(nx * 0.32 + nz * 0.28) * 12
  const strata = Math.cos(nx * 0.12 - nz * 0.18 + seed * 0.0041) * 18
  const valley = Math.sin((nx + nz) * 0.62) * 9
  const plateau = Math.max(0, Math.sin(nx * 0.18 + seed * 0.02) + Math.cos(nz * 0.21 - seed * 0.018)) * 7
  return ridge * 11 + dunes + strata * 0.6 + valley * 0.8 + plateau
}

function generateHeightGrid(seed: number, index: FlightTileIndex, tileSize: number, resolution: number): number[][] {
  //1.- Fill a two-dimensional grid with deterministic height samples anchored to the tile indices.
  const grid: number[][] = []
  const step = tileSize / (resolution - 1)
  for (let row = 0; row < resolution; row += 1) {
    const worldZ = (index.z * tileSize) + row * step
    const samples: number[] = []
    for (let column = 0; column < resolution; column += 1) {
      const worldX = (index.x * tileSize) + column * step
      samples.push(sampleHeight(seed, worldX, worldZ))
    }
    grid.push(samples)
  }
  return grid
}

function buildNormals(grid: number[][], tileSize: number, resolution: number): Float32Array {
  //1.- Approximate normals via central differences so lighting can react to slope changes.
  const normals = new Float32Array(resolution * resolution * 3)
  const step = tileSize / (resolution - 1)
  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      const center = grid[row][column]
      const left = column > 0 ? grid[row][column - 1] : center
      const right = column < resolution - 1 ? grid[row][column + 1] : center
      const top = row > 0 ? grid[row - 1][column] : center
      const bottom = row < resolution - 1 ? grid[row + 1][column] : center
      const dx = (right - left) / (2 * step)
      const dz = (bottom - top) / (2 * step)
      const normal = new THREE.Vector3(-dx, 1, -dz).normalize()
      const baseIndex = (row * resolution + column) * 3
      normals[baseIndex] = normal.x
      normals[baseIndex + 1] = normal.y
      normals[baseIndex + 2] = normal.z
    }
  }
  return normals
}

function flattenGrid(grid: number[][]): Float32Array {
  //1.- Convert the two-dimensional height table into a tightly packed Float32Array for GPU uploads.
  const resolution = grid.length
  const flat = new Float32Array(resolution * resolution)
  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      flat[row * resolution + column] = grid[row][column]
    }
  }
  return flat
}

function computeMetrics(grid: number[][]): FlightTileMetrics {
  //1.- Track height extremes and the rolling average for quick telemetry overlays.
  let minHeight = Number.POSITIVE_INFINITY
  let maxHeight = Number.NEGATIVE_INFINITY
  let sum = 0
  let count = 0
  for (const row of grid) {
    for (const value of row) {
      minHeight = Math.min(minHeight, value)
      maxHeight = Math.max(maxHeight, value)
      sum += value
      count += 1
    }
  }
  return {
    minHeight,
    maxHeight,
    averageHeight: count > 0 ? sum / count : 0,
  }
}

function generateTile(seed: number, index: FlightTileIndex, tileSize: number, resolution: number): GeneratedTile {
  //1.- Assemble the height grid, derived metrics, and tangent-space normals for a single tile.
  const heightGrid = generateHeightGrid(seed, index, tileSize, resolution)
  const heights = flattenGrid(heightGrid)
  const normals = buildNormals(heightGrid, tileSize, resolution)
  const metrics = computeMetrics(heightGrid)
  const origin = { x: index.x * tileSize, z: index.z * tileSize }
  const tile: FlightTile = {
    id: tileKey(index),
    index,
    origin,
    size: tileSize,
    resolution,
    heights,
    normals,
    metrics,
  }
  return { tile, heightGrid }
}

export interface InfiniteFlightField {
  update: (position: THREE.Vector3 | { x: number; z: number }) => void
  tiles: Map<string, FlightTile>
  dispose: () => void
}

export const createInfiniteFlightField = (options: InfiniteFlightFieldOptions = {}): InfiniteFlightField => {
  //1.- Normalise configuration inputs ensuring tile dimensions and resolution stay within safe bounds.
  const seed = options.seed ?? 1337
  const tileSize = options.tileSize && options.tileSize > 0 ? options.tileSize : DEFAULT_TILE_SIZE
  const viewDistance = options.viewDistance !== undefined && options.viewDistance >= 0 ? options.viewDistance : DEFAULT_VIEW_DISTANCE
  const resolution = options.resolution && options.resolution >= MIN_RESOLUTION ? Math.floor(options.resolution) : DEFAULT_RESOLUTION
  const clampedResolution = resolution % 2 === 1 ? resolution : resolution + 1

  const activeTiles = new Map<string, FlightTile>()
  const desiredSet = new Set<string>()

  const ensureTile = (index: FlightTileIndex) => {
    const key = tileKey(index)
    if (!activeTiles.has(key)) {
      const generated = generateTile(seed, index, tileSize, clampedResolution)
      activeTiles.set(key, generated.tile)
      options.onTileLoaded?.(generated.tile)
    }
    desiredSet.add(key)
  }

  const releaseMissingTiles = () => {
    for (const [key, tile] of activeTiles.entries()) {
      if (!desiredSet.has(key)) {
        activeTiles.delete(key)
        options.onTileUnloaded?.(tile)
      }
    }
    desiredSet.clear()
  }

  const update = (position: THREE.Vector3 | { x: number; z: number }) => {
    //1.- Resolve the observer position, derive the central tile, and queue surrounding tiles.
    const x = position.x
    const z = position.z
    const center: FlightTileIndex = { x: Math.floor(x / tileSize), z: Math.floor(z / tileSize) }
    for (let dz = -viewDistance; dz <= viewDistance; dz += 1) {
      for (let dx = -viewDistance; dx <= viewDistance; dx += 1) {
        ensureTile({ x: center.x + dx, z: center.z + dz })
      }
    }
    releaseMissingTiles()
  }

  const dispose = () => {
    //1.- Clear tile caches and emit unload callbacks for deterministic teardown.
    for (const tile of activeTiles.values()) {
      options.onTileUnloaded?.(tile)
    }
    activeTiles.clear()
    desiredSet.clear()
  }

  return {
    update,
    tiles: activeTiles,
    dispose,
  }
}

export { generateTile as debugGenerateFlightTile }
