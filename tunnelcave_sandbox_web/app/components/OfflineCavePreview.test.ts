import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import * as THREE from 'three'
import { startOfflineCavePreview, __testing } from './OfflineCavePreview'

class MockWebGLRenderer {
  //1.- Stand-in renderer captures lifecycle hooks without touching WebGL APIs.
  clearColor?: unknown
  size?: { width: number; height: number }

  constructor(public readonly options: { canvas: HTMLCanvasElement }) {}

  setPixelRatio(): void {
    //2.- Pixel ratio control is irrelevant for the mock renderer.
  }

  setClearColor(color: unknown): void {
    this.clearColor = color
  }

  setSize(width: number, height: number): void {
    this.size = { width, height }
  }

  render(): void {
    //3.- Rendering no-op keeps the animation loop synchronous for tests.
  }

  dispose(): void {
    rendererDisposeMock('renderer')
  }
}

const rendererDisposeMock = vi.fn()
const rendererCtorMock = vi.fn<(options: { canvas: HTMLCanvasElement }) => MockWebGLRenderer>()

function createMockRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new MockWebGLRenderer({ canvas })
  rendererCtorMock({ canvas })
  return renderer as unknown as THREE.WebGLRenderer
}

describe('OfflineCavePreview', () => {
  let rafSpy: ReturnType<typeof vi.spyOn>
  let cafSpy: ReturnType<typeof vi.spyOn>
  let addListenerSpy: ReturnType<typeof vi.spyOn>
  let removeListenerSpy: ReturnType<typeof vi.spyOn>
  let geometryDisposeSpy: ReturnType<typeof vi.spyOn>
  let materialDisposeSpy: ReturnType<typeof vi.spyOn>
  let canvasRoot: HTMLDivElement

  beforeEach(() => {
    //1.- Reset DOM fixtures and stub animation utilities to keep tests deterministic.
    rendererDisposeMock.mockClear()
    rendererCtorMock.mockClear()
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

    if (typeof THREE.Color !== 'function' || typeof THREE.CatmullRomCurve3 !== 'function') {
      throw new Error('three primitives unavailable in test environment')
    }

    const geometryPrototype = THREE.BufferGeometry.prototype as THREE.BufferGeometry & {
      dispose: () => void
    }
    if (typeof geometryPrototype.dispose !== 'function') {
      geometryPrototype.dispose = () => {}
    }
    geometryDisposeSpy = vi
      .spyOn(geometryPrototype, 'dispose')
      .mockImplementation(function mockDispose(this: THREE.BufferGeometry) {
        rendererDisposeMock('geometry')
      })

    const materialPrototype = THREE.MeshStandardMaterial.prototype as THREE.Material & {
      dispose: () => void
    }
    if (typeof materialPrototype.dispose !== 'function') {
      materialPrototype.dispose = () => {}
    }
    materialDisposeSpy = vi
      .spyOn(materialPrototype, 'dispose')
      .mockImplementation(function mockDispose(this: THREE.Material) {
        rendererDisposeMock('material')
      })
  })

  afterEach(() => {
    //1.- Restore spies and detach DOM nodes so every test starts from a clean slate.
    rafSpy.mockRestore()
    cafSpy.mockRestore()
    addListenerSpy.mockRestore()
    removeListenerSpy.mockRestore()
    geometryDisposeSpy.mockRestore()
    materialDisposeSpy.mockRestore()
    canvasRoot.remove()
  })

  it('mounts the preview canvas and tears it down on cleanup', () => {
    const cleanup = startOfflineCavePreview({ canvasRoot, createRenderer: createMockRenderer })

    expect(addListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(rendererCtorMock).toHaveBeenCalled()
    expect(canvasRoot.querySelectorAll('canvas[data-role="offline-cave-canvas"]').length).toBe(1)

    cleanup()

    expect(removeListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(canvasRoot.querySelectorAll('canvas[data-role="offline-cave-canvas"]').length).toBe(0)
    expect(cafSpy).toHaveBeenCalledWith(1)
    expect(rendererDisposeMock).toHaveBeenCalledWith('renderer')
    expect(rendererDisposeMock).toHaveBeenCalledWith('geometry')
    expect(rendererDisposeMock).toHaveBeenCalledWith('material')
  })

  it('replaces an existing preview when invoked again', () => {
    startOfflineCavePreview({ canvasRoot, createRenderer: createMockRenderer })
    startOfflineCavePreview({ canvasRoot, createRenderer: createMockRenderer })
    expect(canvasRoot.querySelectorAll('canvas[data-role="offline-cave-canvas"]').length).toBe(1)
  })

  it('applies procedural colouring to the cave tunnel mesh', () => {
    const curve = __testing.buildTunnelCurve()
    const mesh = __testing.createTunnelMesh(curve)
    const geometry = mesh.geometry as THREE.TubeGeometry

    const colorAttribute = geometry.getAttribute('color') as THREE.BufferAttribute | undefined
    expect(colorAttribute).toBeDefined()

    const colorArray = (colorAttribute?.array ?? new Float32Array()) as Float32Array
    expect(colorArray.length).toBeGreaterThan(0)

    let varied = false
    for (let index = 3; index < colorArray.length; index += 3) {
      if (colorArray[index] !== colorArray[index - 3]) {
        varied = true
        break
      }
    }
    expect(varied).toBe(true)
  })

  it('creates decorative cave props for the preview scene', () => {
    const curve = __testing.buildTunnelCurve()
    const stalactites = __testing.createStalactiteMeshes(curve, 10)
    expect(stalactites).toHaveLength(10)
    stalactites.forEach((mesh) => {
      expect(mesh.position.y).not.toBe(0)
    })

    const crystals = __testing.createCrystalClusters(curve, 6)
    expect(crystals.group.children).toHaveLength(6)
    expect(crystals.materials).toHaveLength(6)

    const dust = __testing.createDustField()
    const dustPositions = dust.geometry.getAttribute('position') as THREE.BufferAttribute
    expect(dustPositions.count).toBeGreaterThan(0)
  })
})
