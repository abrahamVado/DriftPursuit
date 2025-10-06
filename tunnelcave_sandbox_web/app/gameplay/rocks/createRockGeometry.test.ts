import { describe, expect, it, vi } from 'vitest'

describe('createRockGeometry', () => {
  it('produces indexed geometries with stable noise displacement', async () => {
    vi.resetModules()
    class StubBufferAttribute {
      array: Float32Array
      itemSize: number
      count: number
      constructor(array: number[], itemSize: number) {
        this.array = Float32Array.from(array)
        this.itemSize = itemSize
        this.count = this.array.length / itemSize
      }
      setXYZ(index: number, x: number, y: number, z: number): void {
        const offset = index * this.itemSize
        this.array[offset] = x
        this.array[offset + 1] = y
        this.array[offset + 2] = z
      }
      getX(index: number): number {
        return this.array[index * this.itemSize]
      }
      getY(index: number): number {
        return this.array[index * this.itemSize + 1]
      }
      getZ(index: number): number {
        return this.array[index * this.itemSize + 2]
      }
    }
    class StubBufferGeometry {
      type = 'BufferGeometry'
      attributes: Record<string, StubBufferAttribute> = {}
      index: number[] | null = null
      setAttribute(name: string, attribute: StubBufferAttribute): void {
        this.attributes[name] = attribute
      }
      getAttribute(name: string): StubBufferAttribute {
        return this.attributes[name]
      }
      setIndex(value: number[] | null): void {
        this.index = value
      }
      toNonIndexed(): this {
        this.index = null
        return this
      }
      clone(): StubBufferGeometry {
        const clone = new StubBufferGeometry()
        clone.attributes = { ...this.attributes }
        clone.index = this.index ? [...this.index] : null
        return clone
      }
      computeVertexNormals(): void {}
    }
    class StubBoxGeometry extends StubBufferGeometry {
      constructor() {
        super()
        this.type = 'BoxGeometry'
        this.setAttribute('position', new StubBufferAttribute(Array(24 * 3).fill(0), 3))
      }
    }
    class StubCylinderGeometry extends StubBufferGeometry {
      constructor() {
        super()
        this.type = 'CylinderGeometry'
        this.setAttribute('position', new StubBufferAttribute(Array(24 * 3).fill(0), 3))
      }
    }
    class StubIcosahedronGeometry extends StubBufferGeometry {
      constructor() {
        super()
        this.type = 'IcosahedronGeometry'
        this.setAttribute('position', new StubBufferAttribute(Array(20 * 3).fill(0), 3))
      }
    }
    const stub = {
      BufferGeometry: StubBufferGeometry,
      BufferAttribute: StubBufferAttribute,
      BoxGeometry: StubBoxGeometry,
      CylinderGeometry: StubCylinderGeometry,
      IcosahedronGeometry: StubIcosahedronGeometry,
      MathUtils: { degToRad: (degrees: number) => (degrees * Math.PI) / 180 },
    }
    vi.doMock('three', () => stub)
    const { assetRegistry } = await import('../assets/assetCatalog')
    const { createRockGeometry } = await import('./createRockGeometry')
    const geometry = createRockGeometry(0, 101, assetRegistry)
    const repeat = createRockGeometry(0, 101, assetRegistry)
    const positions = geometry.getAttribute('position')
    const repeatPositions = repeat.getAttribute('position')
    expect(positions.count).toBe(repeatPositions.count)
    for (let index = 0; index < positions.count; index += 1) {
      expect(positions.getX(index)).toBeCloseTo(repeatPositions.getX(index))
      expect(positions.getY(index)).toBeCloseTo(repeatPositions.getY(index))
      expect(positions.getZ(index)).toBeCloseTo(repeatPositions.getZ(index))
    }
  })
})

