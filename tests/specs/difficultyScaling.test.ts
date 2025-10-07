import assert from 'node:assert/strict'
import { applyBossDefeat, getDifficultyState, resetDifficultyState } from '@/engine/difficulty'

export function testDifficultyScalingAdjustments(): void {
  //1.- Reset the singleton state to capture deterministic baseline values.
  resetDifficultyState()
  const base = getDifficultyState()

  //2.- Apply multiple boss defeats and validate each key multiplier increases as expected.
  const afterFirst = applyBossDefeat(3)
  const afterSecond = applyBossDefeat(4)
  assert(afterFirst.enemyHpMultiplier > base.enemyHpMultiplier)
  assert(afterSecond.enemyDpsMultiplier > afterFirst.enemyDpsMultiplier)
  assert(afterSecond.spawnIntervalMultiplier < base.spawnIntervalMultiplier)

  //3.- Confirm auxiliary systems (accuracy, unlocks, environment) scale together for downstream consumers.
  assert(afterSecond.enemyAccuracy > base.enemyAccuracy)
  assert(afterSecond.unlockedAddTypes >= afterFirst.unlockedAddTypes)
  assert(afterSecond.environment.propDensity > base.environment.propDensity)
}
