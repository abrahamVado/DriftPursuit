import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const disposeMock = vi.fn()

class Vector3 {
  x: number
  y: number
  z: number

  constructor(x = 0, y = 0, z = 0) {
    this.x = x
    this.y = y
    this.z = z
  }

  clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z)
  }

  copy(vector: Vector3): this {
    this.x = vector.x
    this.y = vector.y
    this.z = vector.z
    return this
  }

  set(x: number, y: number, z: number): this {
    this.x = x
    this.y = y
    this.z = z
    return this
  }

  add(vector: Vector3): this {
    this.x += vector.x
    this.y += vector.y
    this.z += vector.z
    return this
  }
}

class BufferAttribute {
  array: Float32Array
  itemSize: number
  count: number
  needsUpdate = false

  constructor(array: Float32Array, itemSize: number) {
    this.array = array
    this.itemSize = itemSize
    this.count = array.length / itemSize
  }

  getZ(index: number): number {
    return this.array[index * this.itemSize + 2]
  }

  setZ(index: number, value: number): void {
    this.array[index * this.itemSize + 2] = value
  }
}

class BufferGeometry {
  private attributes = new Map<string, BufferAttribute>()

  setAttribute(name: string, attribute: BufferAttribute): void {
    this.attributes.set(name, attribute)
  }

  getAttribute(name: string): BufferAttribute {
    const attribute = this.attributes.get(name)
    if (!attribute) {
      throw new Error(`Attribute ${name} missing`)
    }
    return attribute
  }

  dispose(): void {
    disposeMock('geometry')
  }
}

class Material {
  dispose(): void {
    disposeMock('material')
  }
}

class MeshStandardMaterial extends Material {}
class PointsMaterial extends Material {}

class TubeGeometry extends BufferGeometry {
  constructor(public curve: CatmullRomCurve3) {
    super()
  }
}

class CatmullRomCurve3 {
  constructor(private readonly points: Vector3[]) {}

  getPointAt(t: number): Vector3 {
    const index = Math.floor(t * (this.points.length - 1))
    return this.points[index % this.points.length].clone()
  }
}

class Points {
  geometry: BufferGeometry
  material: Material

  constructor(geometry: BufferGeometry, material: Material) {
    this.geometry = geometry
    this.material = material
  }
}

class Mesh {
  geometry: BufferGeometry
  material: Material

  constructor(geometry: BufferGeometry, material: Material) {
    this.geometry = geometry
    this.material = material
  }
}

class Scene {
  fog: unknown
  private children: unknown[] = []

  add(object: unknown): void {
    this.children.push(object)
  }
}

class PerspectiveCamera {
  aspect = 1
  position = new Vector3()

  lookAt(): void {
    //1.- Stubbed implementation required by the offline preview loop.
  }

  updateProjectionMatrix(): void {
    //2.- Stubbed implementation avoids relying on WebGL internals.
  }
}

class AmbientLight {
  constructor(public color: Color, public intensity: number) {}
}

class DirectionalLight {
  position = new Vector3()

  constructor(public color: Color, public intensity: number) {}
}

class Color {
  constructor(public value: number) {}
}

class FogExp2 {
  constructor(public color: Color, public density: number) {}
}

class WebGLRenderer {
  clearColor?: Color
  size?: { width: number; height: number }

  constructor(public options: { canvas: HTMLCanvasElement }) {}

  setPixelRatio(): void {
    //1.- Stubbed to avoid device specific logic inside tests.
  }

  setClearColor(color: Color): void {
    this.clearColor = color
  }

  setSize(width: number, height: number): void {
    this.size = { width, height }
  }

  render(): void {
    //2.- Rendering no-op keeps the animation loop deterministic for assertions.
  }

  dispose(): void {
    disposeMock('renderer')
  }
}

const AdditiveBlending = 1
const BackSide = 2

vi.mock('three', () => ({
  AmbientLight,
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  DirectionalLight,
  FogExp2,
  Material,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
}))

describe('OfflineCavePreview', () => {
  let rafSpy: ReturnType<typeof vi.spyOn>
  let cafSpy: ReturnType<typeof vi.spyOn>
  let addListenerSpy: ReturnType<typeof vi.spyOn>
  let removeListenerSpy: ReturnType<typeof vi.spyOn>
  let canvasRoot: HTMLDivElement

  beforeEach(() => {
    //1.- Prepare DOM anchors and stub browser APIs that drive the animation loop.
    disposeMock.mockClear()
    canvasRoot = document.createElement('div')
    canvasRoot.style.width = '800px'
    canvasRoot.style.height = '600px'
    document.body.appendChild(canvasRoot)
    let executed = false
    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      if (!executed) {
        executed = true
        callback(0)
      }
      return 1
    })
    cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    addListenerSpy = vi.spyOn(window, 'addEventListener')
    removeListenerSpy = vi.spyOn(window, 'removeEventListener')
  })

  afterEach(() => {
    //1.- Restore DOM and animation spies to keep tests isolated.
    rafSpy.mockRestore()
    cafSpy.mockRestore()
    addListenerSpy.mockRestore()
    removeListenerSpy.mockRestore()
    canvasRoot.remove()
  })

  it('mounts the preview canvas and tears it down on cleanup', async () => {
    const { startOfflineCavePreview } = await import('./OfflineCavePreview')
    const cleanup = startOfflineCavePreview({ canvasRoot })
    expect(addListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(canvasRoot.querySelectorAll('canvas[data-role="offline-cave-canvas"]').length).toBe(1)
    cleanup()
    expect(removeListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(canvasRoot.querySelectorAll('canvas[data-role="offline-cave-canvas"]').length).toBe(0)
    expect(cafSpy).toHaveBeenCalledWith(1)
    expect(disposeMock).toHaveBeenCalled()
  })

  it('replaces an existing preview when invoked again', async () => {
    const { startOfflineCavePreview } = await import('./OfflineCavePreview')
    startOfflineCavePreview({ canvasRoot })
    startOfflineCavePreview({ canvasRoot })
    expect(canvasRoot.querySelectorAll('canvas[data-role="offline-cave-canvas"]').length).toBe(1)
  })
})
