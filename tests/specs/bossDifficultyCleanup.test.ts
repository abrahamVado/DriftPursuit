import assert from 'node:assert/strict'
import * as THREE from 'three'
import { applyBossDefeat, getDifficultyState, resetDifficultyState } from '@/engine/difficulty'
import { createPolyBoss } from '@/enemies/bosses/poly-boss/phases'

export function testBossDifficultyListenerCleanup(): void {
  //1.- Ensure a stable baseline difficulty snapshot before creating the boss fixture.
  resetDifficultyState()
  const scene = new THREE.Scene()
  const boss = createPolyBoss(scene, new THREE.Vector3(), { stage: 3, randomSeed: 9 })

  //2.- Advance difficulty once and confirm the boss mirrors the broadcast values while alive.
  const beforeDefeat = boss.getStateSnapshot().difficulty.bossClears
  applyBossDefeat(3)
  const duringFight = boss.getStateSnapshot().difficulty.bossClears
  assert.equal(duringFight, beforeDefeat + 1)

  //3.- Kill the boss to trigger lifecycle cleanup and repeat the broadcast to verify no further updates propagate.
  boss.onDeath()
  applyBossDefeat(4)
  const afterDeath = boss.getStateSnapshot().difficulty.bossClears
  assert.equal(afterDeath, duringFight)

  //4.- Reset global difficulty so subsequent tests observe a deterministic baseline.
  resetDifficultyState()
  const finalSnapshot = getDifficultyState()
  assert.equal(finalSnapshot.bossClears, 0)
}
