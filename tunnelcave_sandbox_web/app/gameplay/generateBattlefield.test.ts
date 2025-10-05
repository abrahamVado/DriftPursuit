import { describe, expect, it } from 'vitest'

import { generateBattlefield } from './generateBattlefield'

describe('generateBattlefield', () => {
  it('produces deterministic layouts for identical seeds', () => {
    const first = generateBattlefield(1337)
    const second = generateBattlefield(1337)
    expect(first.fieldSize).toBe(second.fieldSize)
    expect(first.spawnPoint.x).toBeCloseTo(second.spawnPoint.x)
    expect(first.spawnPoint.y).toBeCloseTo(second.spawnPoint.y)
    expect(first.spawnPoint.z).toBeCloseTo(second.spawnPoint.z)
    expect(first.environment.boundsRadius).toBeCloseTo(second.environment.boundsRadius)
    expect(first.rocks).toHaveLength(second.rocks.length)
    expect(first.trees).toHaveLength(second.trees.length)
    first.rocks.forEach((rock, index) => {
      const counterpart = second.rocks[index]
      expect(rock.position.x).toBeCloseTo(counterpart.position.x)
      expect(rock.position.y).toBeCloseTo(counterpart.position.y)
      expect(rock.position.z).toBeCloseTo(counterpart.position.z)
      expect(rock.scale.x).toBeCloseTo(counterpart.scale.x)
      expect(rock.archetypeIndex).toBe(counterpart.archetypeIndex)
    })
    for (let offset = -10; offset <= 10; offset += 10) {
      const sampleFirst = first.terrain.sampler.sampleGround(first.spawnPoint.x + offset, first.spawnPoint.z + offset)
      const sampleSecond = second.terrain.sampler.sampleGround(second.spawnPoint.x + offset, second.spawnPoint.z + offset)
      expect(sampleFirst.height).toBeCloseTo(sampleSecond.height)
    }
  })

  it('maintains a gentle runway around spawn while forming hills further out', () => {
    const config = generateBattlefield(2024)
    const sampler = config.terrain.sampler
    const spawnHeights: number[] = []
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
      const x = config.spawnPoint.x + Math.cos(angle) * (config.terrain.spawnRadius * 0.6)
      const z = config.spawnPoint.z + Math.sin(angle) * (config.terrain.spawnRadius * 0.6)
      spawnHeights.push(sampler.sampleGround(x, z).height)
    }
    const minHeight = Math.min(...spawnHeights)
    const maxHeight = Math.max(...spawnHeights)
    expect(maxHeight - minHeight).toBeLessThan(4)

    const farSample = sampler.sampleGround(config.spawnPoint.x + config.terrain.spawnRadius * 3, config.spawnPoint.z)
    expect(farSample.height).toBeGreaterThan(maxHeight)
  })

  it('includes water, rocks, and trees distributed with constraints', () => {
    const config = generateBattlefield(5150)
    expect(config.waters.length).toBeGreaterThan(0)
    const sampler = config.terrain.sampler
    const spawnRadius = config.terrain.spawnRadius + 10

    config.rocks.forEach((rock) => {
      const distance = Math.hypot(rock.position.x - config.spawnPoint.x, rock.position.z - config.spawnPoint.z)
      expect(distance).toBeGreaterThan(spawnRadius)
      const ground = sampler.sampleGround(rock.position.x, rock.position.z)
      expect(ground.slopeRadians).toBeLessThan(config.environment.slopeLimitRadians)
      const water = sampler.sampleWater(rock.position.x, rock.position.z)
      expect(water === Number.NEGATIVE_INFINITY || water < ground.height).toBe(true)
    })

    config.trees.forEach((tree) => {
      const distance = Math.hypot(tree.position.x - config.spawnPoint.x, tree.position.z - config.spawnPoint.z)
      expect(distance).toBeGreaterThan(config.terrain.spawnRadius + 10)
      const ground = sampler.sampleGround(tree.position.x, tree.position.z)
      expect(ground.height).toBeCloseTo(tree.position.y)
      const water = sampler.sampleWater(tree.position.x, tree.position.z)
      expect(water === Number.NEGATIVE_INFINITY || water < ground.height).toBe(true)
    })
  })
})
