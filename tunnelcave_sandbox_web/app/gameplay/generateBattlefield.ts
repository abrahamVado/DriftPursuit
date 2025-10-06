import * as THREE from 'three'

import { assetRegistry } from './assets/assetCatalog'
import { createTerrainSampler } from './terrain/terrainSampler'
import type { TerrainSampler } from './terrain/terrainSampler'

export interface RockInstance {
  position: THREE.Vector3
  scale: THREE.Vector3
  rotation: number
  archetypeIndex: number
}

export interface TreeInstance {
  position: THREE.Vector3
  trunkHeight: number
  canopyRadius: number
  branchCount: number
  variation: number
}

export interface WaterSample {
  position: THREE.Vector3
  level: number
}

export interface BattlefieldEnvironment {
  boundsRadius: number
  vehicleRadius: number
  slopeLimitRadians: number
  bounceDamping: number
  groundSnapStrength: number
  waterDrag: number
  waterBuoyancy: number
  waterMinDepth: number
  maxWaterSpeedScale: number
  wrapSize: number
}

export interface BattlefieldTerrain {
  sampler: TerrainSampler
  spawnRadius: number
}

export interface BattlefieldConfig {
  seed: number
  fieldSize: number
  spawnPoint: THREE.Vector3
  terrain: BattlefieldTerrain
  environment: BattlefieldEnvironment
  rocks: RockInstance[]
  trees: TreeInstance[]
  waters: WaterSample[]
  assets: typeof assetRegistry
}

function mulberry32(seed: number) {
  //1.- Convert the incoming seed into an unsigned integer compatible with the mulberry PRNG reference implementation.
  let t = seed >>> 0
  return () => {
    //2.- Advance and scramble the state to yield deterministic floating point numbers within [0, 1).
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), t | 1)
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

interface SamplePoint {
  x: number
  y: number
}

function poissonSample(
  random: () => number,
  fieldSize: number,
  minSpacing: number,
  maxCount: number,
  guard: (x: number, z: number) => boolean,
): SamplePoint[] {
  //1.- Scatter samples across the play field while respecting a minimum spacing using simple rejection sampling.
  const samples: SamplePoint[] = []
  const maxAttempts = maxCount * 35
  let attempts = 0
  while (samples.length < maxCount && attempts < maxAttempts) {
    attempts += 1
    const x = (random() - 0.5) * fieldSize
    const z = (random() - 0.5) * fieldSize
    if (!guard(x, z)) {
      continue
    }
    let ok = true
    for (const sample of samples) {
      const distance = Math.hypot(sample.x - x, sample.y - z)
      if (distance < minSpacing) {
        ok = false
        break
      }
    }
    if (ok) {
      samples.push({ x, y: z })
    }
  }
  return samples
}

function buildRocks(
  random: () => number,
  terrain: TerrainSampler,
  fieldSize: number,
  spawnPoint: THREE.Vector3,
  spawnRadius: number,
): RockInstance[] {
  //1.- Distribute rock anchors on gentle slopes while steering clear of the spawn cradle and any flooded zones.
  const slopeLimit = THREE.MathUtils.degToRad(38)
  const spacing = 14
  const maxRocks = 42
  const waterBuffer = 1.2
  const guard = (x: number, z: number) => {
    const distance = Math.hypot(x - spawnPoint.x, z - spawnPoint.z)
    if (distance < spawnRadius + 12) {
      return false
    }
    const ground = terrain.sampleGround(x, z)
    if (ground.slopeRadians > slopeLimit) {
      return false
    }
    const waterLevel = terrain.sampleWater(x, z)
    if (waterLevel !== Number.NEGATIVE_INFINITY && waterLevel > ground.height + waterBuffer) {
      return false
    }
    return true
  }
  const anchors = poissonSample(random, fieldSize, spacing, maxRocks, guard)
  const rocks: RockInstance[] = []
  anchors.forEach((anchor) => {
    const archetypeIndex = Math.floor(random() * assetRegistry.rocks.length)
    const archetype = assetRegistry.rocks[archetypeIndex]
    const scale = new THREE.Vector3(
      0.8 + random() * 0.6,
      0.8 + random() * 0.6,
      0.8 + random() * 0.6,
    )
    const ground = terrain.sampleGround(anchor.x, anchor.y)
    const position = new THREE.Vector3(anchor.x, ground.height + archetype.height * 0.5 * scale.y, anchor.y)
    const rotation = random() * Math.PI * 2
    rocks.push({ position, scale, rotation, archetypeIndex })
  })
  return rocks
}

function buildTrees(
  random: () => number,
  terrain: TerrainSampler,
  rocks: RockInstance[],
  fieldSize: number,
  spawnPoint: THREE.Vector3,
  spawnRadius: number,
): TreeInstance[] {
  //1.- Reserve generous spacing so trees do not intersect rocks or spawn infrastructure.
  const slopeLimit = THREE.MathUtils.degToRad(28)
  const spacing = 22
  const maxTrees = 36
  const waterBuffer = 2
  const guard = (x: number, z: number) => {
    const distance = Math.hypot(x - spawnPoint.x, z - spawnPoint.z)
    if (distance < spawnRadius + 14) {
      return false
    }
    const ground = terrain.sampleGround(x, z)
    if (ground.slopeRadians > slopeLimit) {
      return false
    }
    const waterLevel = terrain.sampleWater(x, z)
    if (waterLevel !== Number.NEGATIVE_INFINITY && waterLevel > ground.height + waterBuffer) {
      return false
    }
    for (const rock of rocks) {
      if (Math.hypot(rock.position.x - x, rock.position.z - z) < 6) {
        return false
      }
    }
    return true
  }
  const anchors = poissonSample(random, fieldSize, spacing, maxTrees, guard)
  const species = assetRegistry.trees[0]
  const trees: TreeInstance[] = []
  anchors.forEach((anchor) => {
    const variation = 0.85 + random() * 0.4
    const ground = terrain.sampleGround(anchor.x, anchor.y)
    trees.push({
      position: new THREE.Vector3(anchor.x, ground.height, anchor.y),
      trunkHeight: species.trunkHeight * variation,
      canopyRadius: species.canopyRadius * variation,
      branchCount: Math.max(2, Math.round(species.branchCount * (0.8 + random() * 0.4))),
      variation,
    })
  })
  return trees
}

function surveyWater(
  terrain: TerrainSampler,
  fieldSize: number,
  resolution: number,
): WaterSample[] {
  //1.- Scan the terrain on a grid so the renderer can pre-place water surfaces where lakes form.
  const samples: WaterSample[] = []
  const half = fieldSize / 2
  for (let xIndex = 0; xIndex < resolution; xIndex += 1) {
    for (let zIndex = 0; zIndex < resolution; zIndex += 1) {
      const x = -half + (xIndex / (resolution - 1)) * fieldSize
      const z = -half + (zIndex / (resolution - 1)) * fieldSize
      const water = terrain.sampleWater(x, z)
      if (water === Number.NEGATIVE_INFINITY) {
        continue
      }
      const ground = terrain.sampleGround(x, z)
      if (water <= ground.height) {
        continue
      }
      samples.push({ position: new THREE.Vector3(x, water, z), level: water })
    }
  }
  return samples
}

export function generateBattlefield(seed = Date.now() & 0xffffffff): BattlefieldConfig {
  //1.- Initial setup: determine deterministic random sequence, primary bounds, and spawn layout parameters.
  const random = mulberry32(seed)
  const fieldSize = 420
  const spawnPoint = new THREE.Vector3((random() - 0.5) * 40, 0, (random() - 0.5) * 40)
  const spawnRadius = 32

  //2.- Create the terrain sampler which provides continuous ground, ceiling, and water height queries.
  const terrain = createTerrainSampler({
    seed,
    fieldSize,
    spawnPoint,
    spawnRadius,
    terrain: {
      baseAmplitude: 26,
      baseFrequency: 1.2,
      octaves: 5,
      lacunarity: 2.1,
      gain: 0.45,
      warpStrength: 22,
      warpFrequency: 1.6,
    },
    mountains: {
      intensity: 30,
      threshold: 0.28,
      gain: 0.42,
      lacunarity: 2.2,
      octaves: 4,
      maskRadius: 86,
    },
    water: {
      level: -6,
      basinThreshold: 0.32,
      basinDepth: 18,
      shorelineSmoothness: 0.08,
    },
  })

  //3.- Sample the spawn height so the vehicle rests just above the flattened runway.
  const groundSample = terrain.sampleGround(spawnPoint.x, spawnPoint.z)
  spawnPoint.y = groundSample.height + 4

  //4.- Populate environment props including rocks, trees, and water references.
  const rocks = buildRocks(random, terrain, fieldSize, spawnPoint, spawnRadius)
  const trees = buildTrees(random, terrain, rocks, fieldSize, spawnPoint, spawnRadius)
  const waters = surveyWater(terrain, fieldSize, 32)
  if (waters.length === 0) {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const angle = random() * Math.PI * 2
      const radius = (fieldSize * 0.25) * random()
      const x = spawnPoint.x + Math.cos(angle) * radius
      const z = spawnPoint.z + Math.sin(angle) * radius
      const level = terrain.sampleWater(x, z)
      if (level === Number.NEGATIVE_INFINITY) {
        continue
      }
      const groundAtPoint = terrain.sampleGround(x, z)
      if (level > groundAtPoint.height) {
        terrain.registerWaterOverride(x, z, level, 24)
        waters.push({ position: new THREE.Vector3(x, level, z), level })
        break
      }
    }
    if (waters.length === 0) {
      const fallbackX = spawnPoint.x + fieldSize * 0.18
      const fallbackZ = spawnPoint.z + fieldSize * 0.18
      const forcedLevel = -4
      terrain.registerWaterOverride(fallbackX, fallbackZ, forcedLevel, 28)
      waters.push({ position: new THREE.Vector3(fallbackX, forcedLevel, fallbackZ), level: forcedLevel })
    }
  }

  //5.- Provide vehicle physics constraints tuned to the generated terrain.
  const environment: BattlefieldEnvironment = {
    boundsRadius: fieldSize / 2 - 12,
    vehicleRadius: 2.6,
    slopeLimitRadians: THREE.MathUtils.degToRad(52),
    bounceDamping: 0,
    groundSnapStrength: 18,
    waterDrag: 0.4,
    waterBuoyancy: 14,
    waterMinDepth: 1.6,
    maxWaterSpeedScale: 0.55,
    wrapSize: fieldSize,
  }

  return {
    seed,
    fieldSize,
    spawnPoint,
    terrain: {
      sampler: terrain,
      spawnRadius,
    },
    environment,
    rocks,
    trees,
    waters,
    assets: assetRegistry,
  }
}
