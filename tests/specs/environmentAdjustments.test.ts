import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createStreamer } from '@/world/chunks/streamer'
import { applyBossDefeat, resetDifficultyState } from '@/engine/difficulty'

export async function testEnvironmentAdjustments(): Promise<void> {
  //1.- Initialise a streamer and materialise the origin chunk at baseline difficulty.
  resetDifficultyState()
  const scene = new THREE.Scene()
  const streamer = createStreamer(scene)
  const focus = new THREE.Vector3(0, 0, 0)
  streamer.update(focus)
  const initialChunk = scene.children.find((child) => (child as any).userData?.decorations) as THREE.Mesh | undefined
  assert(initialChunk, 'Expected a terrain chunk to be present after initial update')
  const initialDecorations = (initialChunk!.userData.decorations as THREE.Object3D[]).length

  //2.- Escalate difficulty to trigger higher environmental density and process the refresh tick.
  applyBossDefeat(5)
  streamer.update(focus)
  const refreshedDecorations = (initialChunk!.userData.decorations as THREE.Object3D[]).length
  assert(refreshedDecorations >= initialDecorations)

  //3.- Dispose the streamer to avoid leaking difficulty subscriptions once the test concludes.
  streamer.dispose?.()
}
