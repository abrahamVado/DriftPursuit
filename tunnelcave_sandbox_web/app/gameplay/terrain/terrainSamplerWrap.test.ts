import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { createTerrainSampler } from './terrainSampler'

describe('terrainSampler wrapping', () => {
  it('mirrors ground samples across seamless tiles', () => {
    //1.- Initialise a sampler with deterministic parameters and matching wrap expectations.
    const fieldSize = 120
    const sampler = createTerrainSampler({
      seed: 12345,
      fieldSize,
      spawnPoint: new THREE.Vector3(0, 0, 0),
      spawnRadius: 18,
      terrain: {
        baseAmplitude: 20,
        baseFrequency: 1.1,
        octaves: 4,
        lacunarity: 2,
        gain: 0.48,
        warpStrength: 18,
        warpFrequency: 1.4,
      },
      mountains: {
        intensity: 24,
        threshold: 0.32,
        gain: 0.4,
        lacunarity: 2.2,
        octaves: 3,
        maskRadius: 64,
      },
      water: {
        level: -4,
        basinThreshold: 0.28,
        basinDepth: 12,
        shorelineSmoothness: 0.06,
      },
    })
    const originSample = sampler.sampleGround(20, -15)
    const wrappedSample = sampler.sampleGround(20 + fieldSize, -15 - fieldSize)
    expect(originSample.height).toBeCloseTo(wrappedSample.height)
    expect(originSample.normal.y).toBeCloseTo(wrappedSample.normal.y, 3)
  })

  it('wraps registered water overrides so lakes repeat seamlessly', () => {
    //1.- Register a water override outside the primary tile and verify the mirrored coordinate samples it.
    const fieldSize = 120
    const sampler = createTerrainSampler({
      seed: 54321,
      fieldSize,
      spawnPoint: new THREE.Vector3(0, 0, 0),
      spawnRadius: 16,
      terrain: {
        baseAmplitude: 18,
        baseFrequency: 1.2,
        octaves: 4,
        lacunarity: 2.1,
        gain: 0.5,
        warpStrength: 16,
        warpFrequency: 1.6,
      },
      mountains: {
        intensity: 22,
        threshold: 0.3,
        gain: 0.38,
        lacunarity: 2.3,
        octaves: 3,
        maskRadius: 60,
      },
      water: {
        level: -5,
        basinThreshold: 0.3,
        basinDepth: 10,
        shorelineSmoothness: 0.05,
      },
    })
    sampler.registerWaterOverride(fieldSize / 2 + 8, 0, -2, 10)
    const mirroredHeight = sampler.sampleWater(-fieldSize / 2 + 8, 0)
    expect(mirroredHeight).toBeCloseTo(-2)
  })
})

