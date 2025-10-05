import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('three', () => {
  class CanvasTexture {
    //1.- Store the backing canvas so assertions can verify construction without GPU access.
    image: HTMLCanvasElement
    colorSpace: string | null = null
    anisotropy = 0
    constructor(image: HTMLCanvasElement) {
      this.image = image
    }
    dispose() {}
  }

  class SpriteMaterial {
    map: CanvasTexture | null
    transparent: boolean
    constructor({ map, transparent }: { map: CanvasTexture; transparent: boolean }) {
      this.map = map
      this.transparent = transparent
    }
    dispose() {
      this.map = null
    }
  }

  class Sprite {
    material: SpriteMaterial
    center = { x: 0.5, y: 0, set: (x: number, y: number) => { this.center.x = x; this.center.y = y } }
    position = {
      x: 0,
      y: 0,
      z: 0,
      set: (x: number, y: number, z: number) => {
        this.position.x = x
        this.position.y = y
        this.position.z = z
      },
    }
    scale = {
      x: 1,
      y: 1,
      z: 1,
      set: (x: number, y: number, z: number) => {
        this.scale.x = x
        this.scale.y = y
        this.scale.z = z
      },
    }
    constructor(material: SpriteMaterial) {
      this.material = material
    }
  }

  return {
    CanvasTexture,
    Sprite,
    SpriteMaterial,
    SRGBColorSpace: 'srgb',
  }
})

import { createNameplateSprite } from './nameplate'

const contextStub: Partial<CanvasRenderingContext2D> = {
  //1.- Provide no-op drawing primitives so jsdom tests can exercise sprite creation logic without a real canvas implementation.
  clearRect: () => {},
  beginPath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  quadraticCurveTo: () => {},
  closePath: () => {},
  fill: () => {},
  fillText: () => {},
  set fillStyle(_value: string) {},
  set font(_value: string) {},
  set textAlign(_value: CanvasTextAlign) {},
  set textBaseline(_value: CanvasTextBaseline) {},
}

beforeAll(() => {
  //1.- Shim the canvas context getter so sprite construction succeeds under jsdom.
  vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => contextStub as CanvasRenderingContext2D)
})

afterAll(() => {
  vi.restoreAllMocks()
})

describe('createNameplateSprite', () => {
  it('creates a sprite anchored from the bottom centre so it floats above the craft', () => {
    //1.- Build the sprite and ensure it positions correctly relative to its parent craft.
    const { sprite, dispose } = createNameplateSprite('Falcon Leader')
    expect(sprite.center.x).toBeCloseTo(0.5)
    expect(sprite.center.y).toBe(0)
    expect(sprite.position.y).toBeGreaterThan(0)
    const material = sprite.material
    expect(material.map).not.toBeNull()
    dispose()
  })

  it('falls back to a generic callsign when provided with blank input', () => {
    //1.- Blank values should not throw and should still generate a texture for rendering.
    const { sprite, dispose } = createNameplateSprite('   ')
    const material = sprite.material
    expect(material.map).not.toBeNull()
    dispose()
  })
})
