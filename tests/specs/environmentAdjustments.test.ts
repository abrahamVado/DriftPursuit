import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createStreamer } from '@/world/chunks/streamer'
import { applyBossDefeat, resetDifficultyState } from '@/engine/difficulty'

export async function testEnvironmentAdjustments(): Promise<void> {
  //1.- Initialise a streamer and materialise the origin chunk at baseline difficulty.
  resetDifficultyState()
  const scene = new THREE.Scene()
  const previousDocument = (globalThis as any).document
  if (!previousDocument) {
    //1.- Provide a minimal DOM shim so Three.js texture loaders can bootstrap in the Node test runtime.
    const factory = () => ({
      setAttribute: () => {},
      style: {},
      appendChild: () => {},
      addEventListener: () => {},
      removeEventListener: () => {}
    })
    ;(globalThis as any).document = {
      createElementNS: factory,
      createElement: factory
    } as unknown as Document
  }
  const previousImage = (globalThis as any).Image
  if (!previousImage) {
    ;(globalThis as any).Image = class {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      addEventListener(event: string, handler: () => void) {
        if (event === 'load') this.onload = handler
        if (event === 'error') this.onerror = handler
      }
      removeEventListener() {}
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }
  }
  const originalTextureLoader = THREE.TextureLoader.prototype.load
  THREE.TextureLoader.prototype.load = function (_url: string, onLoad?: (texture: THREE.Texture) => void) {
    const texture = new THREE.Texture()
    onLoad?.(texture)
    return texture
  }
  const streamer = createStreamer(scene)
  const focus = new THREE.Vector3(0, 0, 0)
  streamer.update(focus, 0)
  const initialChunk = scene.children.find((child) => (child as any).userData?.decorations) as THREE.Mesh | undefined
  assert(initialChunk, 'Expected a terrain chunk to be present after initial update')
  const initialDecorations = (initialChunk!.userData.decorations as THREE.Object3D[]).length

  //2.- Escalate difficulty to trigger higher environmental density and process the refresh tick.
  applyBossDefeat(5)
  streamer.update(focus, 0)
  const refreshedDecorations = (initialChunk!.userData.decorations as THREE.Object3D[]).length
  assert(refreshedDecorations >= initialDecorations)

  //3.- Dispose the streamer to avoid leaking difficulty subscriptions once the test concludes.
  streamer.dispose?.()
  THREE.TextureLoader.prototype.load = originalTextureLoader
  if (!previousImage) {
    delete (globalThis as any).Image
  }
  if (!previousDocument) {
    delete (globalThis as any).document
  }
}
