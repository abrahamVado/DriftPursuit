import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createPolyBoss } from '@/enemies/bosses/poly-boss/phases'
import { getDifficultyState, resetDifficultyState } from '@/engine/difficulty'

export function testBossPhasesStateMachine(): void {
  //1.- Start from a clean slate so prior tests do not leak altered difficulty state.
  resetDifficultyState()
  const scene = new THREE.Scene()
  const boss = createPolyBoss(scene, new THREE.Vector3(), { stage: 2, randomSeed: 42 })

  //2.- Validate the boss opens in the shield phase and reacts when the barrier is depleted.
  boss.update(0.16)
  assert.equal(boss.getPhase(), 'shield')
  boss.takeDamage(800)
  boss.update(0.16)
  assert.equal(boss.getPhase(), 'assault')

  //3.- Strip additional health to trigger the core exposure stage and verify the enraged flip once low.
  boss.takeDamage(1200)
  boss.update(0.16)
  assert.equal(boss.getPhase(), 'core')
  boss.takeDamage(200)
  for (let i = 0; i < 10; i++) boss.update(0.5)
  assert.equal(boss.getPhase(), 'enrage')
  const snapshot = boss.getStateSnapshot()
  assert.equal(snapshot.enraged, true)

  //4.- Destroy the boss and confirm the defeat propagated to the shared difficulty tracker.
  boss.onDeath()
  const difficulty = getDifficultyState()
  assert.equal(difficulty.bossClears > 0, true)
  assert.equal(scene.children.includes(boss.mesh), false)
}
