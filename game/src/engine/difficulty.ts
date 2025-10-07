import type { Vector3 } from 'three'

export type DifficultyEnvironmentState = {
  propDensity: number
  windStrength: number
  canyonWidth: number
}

export type DifficultyState = {
  enemyHpMultiplier: number
  enemyDpsMultiplier: number
  spawnIntervalMultiplier: number
  enemyAccuracy: number
  unlockedAddTypes: number
  bossClears: number
  lastClearedStage: number
  environment: DifficultyEnvironmentState
}

type DifficultyListener = (state: DifficultyState) => void

const BASE_STATE: DifficultyState = {
  enemyHpMultiplier: 1,
  enemyDpsMultiplier: 1,
  spawnIntervalMultiplier: 1,
  enemyAccuracy: 0.55,
  unlockedAddTypes: 1,
  bossClears: 0,
  lastClearedStage: 0,
  environment: {
    propDensity: 0.6,
    windStrength: 0.4,
    canyonWidth: 1
  }
}

let state: DifficultyState = structuredClone(BASE_STATE)
const listeners = new Set<DifficultyListener>()

function cloneState(): DifficultyState {
  //1.- Provide callers with a defensive copy so internal difficulty bookkeeping remains encapsulated.
  return {
    enemyHpMultiplier: state.enemyHpMultiplier,
    enemyDpsMultiplier: state.enemyDpsMultiplier,
    spawnIntervalMultiplier: state.spawnIntervalMultiplier,
    enemyAccuracy: state.enemyAccuracy,
    unlockedAddTypes: state.unlockedAddTypes,
    bossClears: state.bossClears,
    lastClearedStage: state.lastClearedStage,
    environment: { ...state.environment }
  }
}

function emit(): void {
  //1.- Notify every subscriber using the freshly cloned snapshot to prevent accidental mutation.
  const snapshot = cloneState()
  for (const listener of listeners) {
    listener(snapshot)
  }
}

export function getDifficultyState(): DifficultyState {
  //1.- Surface the current state without exposing the mutable singleton to consumers.
  return cloneState()
}

export function onDifficultyChange(listener: DifficultyListener): () => void {
  //1.- Register listeners lazily and hand back an unsubscribe hook for lifecycle management.
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function applyBossDefeat(stage: number): DifficultyState {
  //1.- Increment the defeat counter before computing the compound scaling adjustments.
  state.bossClears += 1
  state.lastClearedStage = Math.max(state.lastClearedStage, stage)

  //2.- Increase enemy durability and damage output multiplicatively to keep pressure scaling noticeable.
  const hpScalar = 1 + 0.08 + stage * 0.015
  const dpsScalar = 1 + 0.05 + stage * 0.01
  state.enemyHpMultiplier = Math.min(6, state.enemyHpMultiplier * hpScalar)
  state.enemyDpsMultiplier = Math.min(5, state.enemyDpsMultiplier * dpsScalar)

  //3.- Tighten spawn intervals while ensuring they do not collapse entirely.
  state.spawnIntervalMultiplier = Math.max(0.32, state.spawnIntervalMultiplier * 0.9)

  //4.- Improve AI accuracy and unlock extra add archetypes gradually.
  state.enemyAccuracy = Math.min(0.98, state.enemyAccuracy + 0.04 + stage * 0.005)
  const unlocked = 1 + Math.floor(state.bossClears / 2)
  state.unlockedAddTypes = Math.min(3, Math.max(state.unlockedAddTypes, unlocked))

  //5.- Enrich the world ambience so victories feel impactful in the overworld streaming logic.
  state.environment.propDensity = Math.min(3, state.environment.propDensity + 0.18 + stage * 0.02)
  state.environment.windStrength = Math.min(4, state.environment.windStrength + 0.16 + stage * 0.01)
  state.environment.canyonWidth = Math.min(3.2, state.environment.canyonWidth + 0.12 + stage * 0.008)

  //6.- Emit the updated snapshot to listeners and provide the caller the same information for chaining.
  emit()
  return cloneState()
}

export function resetDifficultyState(): void {
  //1.- Restore baseline values primarily for deterministic testing scenarios.
  state = structuredClone(BASE_STATE)
  emit()
}

export function applyEnvironmentVectorAttenuation(vec: Vector3): Vector3 {
  //1.- Adjust a direction vector to simulate wind influence according to the current scaling knobs.
  const { windStrength } = state.environment
  vec.multiplyScalar(1 + windStrength * 0.05)
  return vec
}
