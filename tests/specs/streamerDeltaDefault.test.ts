import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createStreamer } from '@/world/chunks/streamer'
import { resetDifficultyState } from '@/engine/difficulty'

export async function testStreamerDeltaDefault(): Promise<void> {
  //1.- Reset the shared difficulty state so procedural seeds remain deterministic for the test.
  resetDifficultyState()

  const scene = new THREE.Scene()
  const previousDocument = (globalThis as any).document
  if (!previousDocument) {
    //2.- Provide a lightweight DOM shim so Three.js texture loaders can instantiate without a browser.
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
    //3.- Shim the Image constructor to immediately resolve loader callbacks during the unit test.
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
    //4.- Return an in-memory texture so chunk materials finalise instantly.
    const texture = new THREE.Texture()
    onLoad?.(texture)
    return texture
  }

  const streamer = createStreamer(scene)
  const focus = new THREE.Vector3(0, 0, 0)

  //5.- Invoke the streamer without supplying a delta and confirm terrain still materialises around the player.
  streamer.update(focus)
  const chunk = scene.children.find((child) => (child as any).userData?.decorations) as THREE.Mesh | undefined
  assert(chunk, 'Expected streamer.update to spawn a terrain chunk even without an explicit delta time')

  //6.- Dispose resources and restore global shims before leaving the test.
  streamer.dispose?.()
  THREE.TextureLoader.prototype.load = originalTextureLoader
  if (!previousImage) {
    delete (globalThis as any).Image
  }
  if (!previousDocument) {
    delete (globalThis as any).document
  }
}

