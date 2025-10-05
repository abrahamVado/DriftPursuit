import { describe, expect, it } from 'vitest'

import { generateBattlefield } from './generateBattlefield'

describe('generateBattlefield', () => {
  it('produces deterministic layouts for identical seeds', () => {
    const first = generateBattlefield(1337, 6)
    const second = generateBattlefield(1337, 6)
    expect(first.fieldSize).toBe(second.fieldSize)
    expect(first.groundY).toBe(second.groundY)
    expect(first.ceilingY).toBe(second.ceilingY)
    expect(first.spawnPoint.x).toBeCloseTo(second.spawnPoint.x)
    expect(first.spawnPoint.y).toBeCloseTo(second.spawnPoint.y)
    expect(first.spawnPoint.z).toBeCloseTo(second.spawnPoint.z)
    expect(first.features).toHaveLength(second.features.length)
    first.features.forEach((feature, index) => {
      const counterpart = second.features[index]
      expect(feature.position.x).toBeCloseTo(counterpart.position.x)
      expect(feature.position.y).toBeCloseTo(counterpart.position.y)
      expect(feature.position.z).toBeCloseTo(counterpart.position.z)
      expect(feature.radius).toBeCloseTo(counterpart.radius)
      expect(feature.depth).toBeCloseTo(counterpart.depth)
    })
  })

  it('places the spawn point within the battlefield bounds', () => {
    const config = generateBattlefield(9090, 12)
    expect(config.spawnPoint.y).toBeGreaterThan(config.groundY)
    expect(config.spawnPoint.y).toBeLessThan(config.ceilingY)
    expect(Math.abs(config.spawnPoint.x)).toBeLessThanOrEqual(config.fieldSize * 0.5)
    expect(Math.abs(config.spawnPoint.z)).toBeLessThanOrEqual(config.fieldSize * 0.5)
  })
})

