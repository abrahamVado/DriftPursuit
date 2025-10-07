type SeedSnapshot = {
  worldId: string
  mapId: string
  worldSeed: number
  mapSeed: number
  decorationSeed: number
  noiseOffsetX: number
  noiseOffsetZ: number
  frequencyJitter: number
}

const DEFAULT_WORLD_ID = 'default-world'
const DEFAULT_MAP_ID = 'default-map'

let snapshot: SeedSnapshot = computeSnapshot({ worldId: DEFAULT_WORLD_ID, mapId: DEFAULT_MAP_ID })

function hashString(input: string): number {
  //1.- Apply an FNV-1a style hash so identical identifiers collapse to a deterministic 32-bit seed.
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function mixSeeds(a: number, b: number): number {
  //2.- Combine two 32-bit seeds while preserving diffusion across the full integer range.
  let h = Math.imul(a ^ 0x9e3779b9, 0x7f4a7c15)
  h = Math.imul(h ^ (h >>> 15), 0x94d049bb)
  h ^= b
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995)
  return h >>> 0
}

function normalise(seed: number): number {
  //3.- Project a 32-bit unsigned integer into [0,1) space without floating-point drift.
  return seed / 0xffffffff
}

function computeSnapshot({ worldId, mapId }: { worldId: string; mapId: string }): SeedSnapshot {
  //4.- Derive the hashed seeds while tracking the canonical identifier strings for diagnostics.
  const trimmedWorld = worldId.trim() || DEFAULT_WORLD_ID
  const trimmedMap = mapId.trim() || DEFAULT_MAP_ID
  const worldSeed = hashString(trimmedWorld)
  const mapSeed = hashString(trimmedMap)
  const decorationSeed = mixSeeds(worldSeed, mapSeed)
  const offsetScalar = 4096
  const noiseOffsetX = (normalise(worldSeed) - 0.5) * offsetScalar
  const noiseOffsetZ = (normalise(mapSeed) - 0.5) * offsetScalar
  const jitterRaw = normalise(decorationSeed) * 1.2
  const frequencyJitter = Math.min(1, Math.max(0, jitterRaw))
  return {
    worldId: trimmedWorld,
    mapId: trimmedMap,
    worldSeed,
    mapSeed,
    decorationSeed,
    noiseOffsetX,
    noiseOffsetZ,
    frequencyJitter
  }
}

export function configureWorldSeeds({ worldId, mapId }: { worldId?: string; mapId?: string } = {}): SeedSnapshot {
  //5.- Store the freshly computed seed snapshot so shared terrain helpers can stay in sync.
  snapshot = computeSnapshot({
    worldId: worldId ?? DEFAULT_WORLD_ID,
    mapId: mapId ?? DEFAULT_MAP_ID
  })
  return snapshot
}

export function getWorldSeedSnapshot(): SeedSnapshot {
  //6.- Surface the cached seed metadata for consumers that need deterministic offsets.
  return snapshot
}
