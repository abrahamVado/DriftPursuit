import { describe, expect, it, vi } from 'vitest'

describe('createPlanetShell', () => {
  it('creates a back-faced sphere sized to the requested radius', async () => {
    vi.resetModules()
    const geometryDispose = vi.fn()
    const materialDispose = vi.fn()
    class StubSphereGeometry {
      parameters: { radius: number }
      type = 'SphereGeometry'
      constructor(radius: number) {
        this.parameters = { radius }
      }
      dispose = geometryDispose
    }
    class StubMeshStandardMaterial {
      side: unknown
      map?: unknown
      constructor(options: { side: unknown; map?: unknown }) {
        this.side = options.side
        this.map = options.map
      }
      dispose = materialDispose
    }
    class StubMesh {
      name = ''
      constructor(public geometry: StubSphereGeometry, public material: StubMeshStandardMaterial) {}
    }
    class StubColor {
      constructor(public value: unknown) {}
    }
    const textureDispose = vi.fn()
    class StubDataTexture {
      wrapS: unknown
      wrapT: unknown
      colorSpace: unknown
      format: unknown
      anisotropy = 0
      needsUpdate = false
      constructor(public data: Uint8Array, public width: number, public height: number, format: unknown) {
        this.format = format
      }
      dispose = textureDispose
    }
    const stub = {
      SphereGeometry: StubSphereGeometry,
      MeshStandardMaterial: StubMeshStandardMaterial,
      Mesh: StubMesh,
      Color: StubColor,
      BackSide: 'back-face',
      DataTexture: StubDataTexture,
      RepeatWrapping: 'repeat-wrap',
      RGBAFormat: 'rgba-format',
      SRGBColorSpace: 'srgb-space',
    }
    vi.doMock('three', () => stub)
    vi.doMock('./rockyPlanetTexture', () => ({
      generateRockyPlanetTexture: () => ({ size: 2, data: new Uint8Array(16) }),
    }))
    const { createPlanetShell } = await import('./createPlanetShell')
    const { mesh, dispose } = createPlanetShell({
      radius: 180,
      color: 0x0b1d3b,
      emissive: 0x112b58,
      opacity: 0.82,
    })
    //1.- Ensure the geometry uses the spherical primitive requested for the planetary enclosure.
    expect((mesh.geometry as StubSphereGeometry).parameters.radius).toBe(180)
    //2.- Confirm the material renders the interior faces to keep the shell from hiding gameplay elements.
    const material = mesh.material as StubMeshStandardMaterial
    expect(material.side).toBe('back-face')
    const map = material.map as StubDataTexture
    expect(map).toBeInstanceOf(StubDataTexture)
    expect(map.wrapS).toBe('repeat-wrap')
    expect(map.wrapT).toBe('repeat-wrap')
    expect(map.colorSpace).toBe('srgb-space')
    dispose()
    expect(geometryDispose).toHaveBeenCalled()
    expect(materialDispose).toHaveBeenCalled()
    expect(textureDispose).toHaveBeenCalled()
  })
})

