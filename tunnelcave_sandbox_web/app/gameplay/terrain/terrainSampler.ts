import * as THREE from 'three'

import { createValueNoise2D, domainWarp, fractalNoise, ridgedMultifractal } from './noise'
import { wrapToInterval, wrappedDelta } from '../worldWrapping'

export interface TerrainTunables {
  baseAmplitude: number
  baseFrequency: number
  octaves: number
  lacunarity: number
  gain: number
  warpStrength: number
  warpFrequency: number
}

export interface MountainTunables {
  intensity: number
  threshold: number
  gain: number
  lacunarity: number
  octaves: number
  maskRadius: number
}

export interface WaterTunables {
  level: number
  basinThreshold: number
  basinDepth: number
  shorelineSmoothness: number
}

export interface TerrainSamplerOptions {
  seed: number
  fieldSize: number
  spawnPoint: THREE.Vector3
  spawnRadius: number
  terrain: TerrainTunables
  mountains: MountainTunables
  water: WaterTunables
}

export interface TerrainSample {
  height: number
  normal: THREE.Vector3
  slopeRadians: number
}

export interface TerrainSampler {
  sampleGround: (x: number, z: number) => TerrainSample
  sampleCeiling: (x: number, z: number) => number
  sampleWater: (x: number, z: number) => number
  flatSpawnRadius: number
  registerWaterOverride: (x: number, z: number, level: number, radius: number) => void
}

export function createTerrainSampler(options: TerrainSamplerOptions): TerrainSampler {
  //1.- Prepare reusable vectors to avoid allocations during repeated sampling and set up noise generators tied to the seed.
  const noise = createValueNoise2D(options.seed)
  const spawnPoint = options.spawnPoint.clone()
  const spawnRadius = options.spawnRadius
  const waterOverrides: { x: number; z: number; level: number; radius: number }[] = []

  const wrapCoordinate = (value: number) => wrapToInterval(value, options.fieldSize)

  const distanceToSpawn = (x: number, z: number) => {
    const dx = wrappedDelta(x, spawnPoint.x, options.fieldSize)
    const dz = wrappedDelta(z, spawnPoint.z, options.fieldSize)
    return Math.hypot(dx, dz)
  }

  const computeBaseHeight = (x: number, z: number) => {
    const sx = wrapCoordinate(x)
    const sz = wrapCoordinate(z)
    //2.- Warp the domain and accumulate fractal brownian motion to produce rolling hills around the arena.
    const warpedCoord = domainWarp(
      noise,
      sx * 0.0025,
      sz * 0.0025,
      options.terrain.warpStrength,
      options.terrain.warpFrequency,
    )
    const fbm = fractalNoise(noise, warpedCoord.x, warpedCoord.z, {
      amplitude: options.terrain.baseAmplitude,
      frequency: options.terrain.baseFrequency,
      octaves: options.terrain.octaves,
      gain: options.terrain.gain,
      lacunarity: options.terrain.lacunarity,
    })
    return fbm * options.terrain.baseAmplitude
  }

  const computeMountainContribution = (x: number, z: number) => {
    const sx = wrapCoordinate(x)
    const sz = wrapCoordinate(z)
    //3.- Shape ridged multifractal peaks and mask them so they ramp in away from the spawn runway.
    const ridge = ridgedMultifractal(noise, sx * 0.002, sz * 0.002, {
      amplitude: options.mountains.intensity,
      frequency: options.terrain.baseFrequency,
      octaves: options.mountains.octaves,
      gain: options.mountains.gain,
      lacunarity: options.mountains.lacunarity,
    })
    const distance = distanceToSpawn(sx, sz)
    const mask = Math.min(1, Math.max(0, (distance - spawnRadius) / Math.max(1, options.mountains.maskRadius)))
    const boosted = Math.max(0, ridge - options.mountains.threshold) * options.mountains.intensity
    return boosted * mask
  }

  const shorelineSmooth = options.water.shorelineSmoothness

  const computeGroundHeight = (x: number, z: number) => {
    //4.- Blend the base height and mountain component while ensuring the spawn pocket remains comfortably flat.
    const base = computeBaseHeight(x, z)
    const mountains = computeMountainContribution(x, z)
    const rawHeight = base + mountains
    const distance = distanceToSpawn(x, z)
    if (distance < spawnRadius) {
      const t = distance / spawnRadius
      return rawHeight * t * t
    }
    return rawHeight
  }

  const sampleGround = (x: number, z: number): TerrainSample => {
    //5.- Calculate the ground height, then differentiate via central differences to obtain a normal and slope angle while guarding against degenerate gradients.
    const height = computeGroundHeight(x, z)
    const epsilon = 0.75
    const hx = computeGroundHeight(x + epsilon, z) - computeGroundHeight(x - epsilon, z)
    const hz = computeGroundHeight(x, z + epsilon) - computeGroundHeight(x, z - epsilon)
    const nx = -hx
    const ny = 2 * epsilon
    const nz = -hz
    const normal = new THREE.Vector3(nx, ny, nz)
    if (normal.lengthSq() === 0) {
      normal.set(0, 1, 0)
    } else {
      normal.normalize()
    }
    const slopeRadians = Math.acos(Math.max(-1, Math.min(1, normal.y)))
    return { height, normal, slopeRadians }
  }

  const sampleCeiling = () => {
    //6.- Provide a generous flight ceiling for now while still allowing future procedural overrides.
    return options.water.level + 120
  }

  const sampleWater = (x: number, z: number) => {
    //7.- Lower the terrain into basins wherever the noise dips under the threshold to form deterministic lakes.
    for (const override of waterOverrides) {
      const dx = wrappedDelta(x, override.x, options.fieldSize)
      const dz = wrappedDelta(z, override.z, options.fieldSize)
      const distance = Math.hypot(dx, dz)
      if (distance < override.radius) {
        return override.level
      }
    }
    const sx = wrapCoordinate(x)
    const sz = wrapCoordinate(z)
    const basinNoise = fractalNoise(noise, sx * 0.0014, sz * 0.0014, {
      amplitude: 1,
      frequency: 1,
      octaves: 4,
      gain: 0.5,
      lacunarity: 2.2,
    })
    if (basinNoise < options.water.basinThreshold) {
      const basinDepth = (options.water.basinThreshold - basinNoise) * options.water.basinDepth
      return options.water.level - basinDepth
    }
    if (basinNoise < options.water.basinThreshold + shorelineSmooth) {
      const t = (basinNoise - options.water.basinThreshold) / shorelineSmooth
      return options.water.level - (1 - t) * (options.water.basinDepth * 0.25)
    }
    return Number.NEGATIVE_INFINITY
  }

  return {
    sampleGround,
    sampleCeiling,
    sampleWater,
    flatSpawnRadius: spawnRadius,
    registerWaterOverride: (x: number, z: number, level: number, radius: number) => {
      waterOverrides.push({ x: wrapCoordinate(x), z: wrapCoordinate(z), level, radius })
    },
  }
}
