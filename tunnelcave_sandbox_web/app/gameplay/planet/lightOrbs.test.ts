import { describe, expect, it, vi } from 'vitest'

describe('light orbs', () => {
  const installThreeStub = () => {
    class StubVector3 {
      constructor(public x = 0, public y = 0, public z = 0) {}
      copy(vector: StubVector3): StubVector3 {
        this.x = vector.x
        this.y = vector.y
        this.z = vector.z
        return this
      }
      setScalar(value: number): StubVector3 {
        this.x = value
        this.y = value
        this.z = value
        return this
      }
    }
    class StubObject3D {
      type = 'Object3D'
      position = new StubVector3()
      children: StubObject3D[] = []
      add(child: StubObject3D): void {
        this.children.push(child)
      }
    }
    class StubGroup extends StubObject3D {
      override type = 'Group'
    }
    class StubMesh extends StubObject3D {
      override type = 'Mesh'
      scale = new StubVector3(1, 1, 1)
      constructor(public geometry: unknown, public material: unknown) {
        super()
      }
    }
    class StubPointLight extends StubObject3D {
      override type = 'PointLight'
      constructor(public color: unknown, public intensity: number, public distance: number, public decay: number) {
        super()
      }
    }
    class StubSphereGeometry {}
    class StubMeshBasicMaterial {}
    class StubColor {
      constructor(public value: unknown) {}
    }
    const stub = {
      Vector3: StubVector3,
      Group: StubGroup,
      Mesh: StubMesh,
      PointLight: StubPointLight,
      SphereGeometry: StubSphereGeometry,
      MeshBasicMaterial: StubMeshBasicMaterial,
      Color: StubColor,
    }
    vi.doMock('three', () => stub)
    return stub
  }

  it('generates deterministic orb placements within the battlefield bounds', async () => {
    vi.resetModules()
    installThreeStub()
    const { generateOrbSpecifications } = await import('./lightOrbs')
    const specs = generateOrbSpecifications({
      seed: 42,
      fieldSize: 400,
      altitudeRange: { min: 6, max: 22 },
      radiusRange: { min: 1.2, max: 3 },
      count: 6,
    })
    //1.- Confirm the generator returns the requested number of placements.
    expect(specs).toHaveLength(6)
    //2.- Validate the placements fall inside the planetary volume and stay above the floor plane.
    specs.forEach((spec) => {
      expect(Math.hypot(spec.position.x, spec.position.z)).toBeLessThanOrEqual(400 * 0.5)
      expect(spec.position.y).toBeGreaterThanOrEqual(6)
      expect(spec.position.y).toBeLessThanOrEqual(22)
    })
    //3.- Ensure the same seed reproduces identical positions for synchronised lighting between clients.
    const repeat = generateOrbSpecifications({
      seed: 42,
      fieldSize: 400,
      altitudeRange: { min: 6, max: 22 },
      radiusRange: { min: 1.2, max: 3 },
      count: 6,
    })
    repeat.forEach((spec, index) => {
      expect(spec.position.x).toBeCloseTo(specs[index].position.x)
      expect(spec.position.y).toBeCloseTo(specs[index].position.y)
      expect(spec.position.z).toBeCloseTo(specs[index].position.z)
    })
  })

  it('creates a disposable group so the orb field can be torn down cleanly', async () => {
    vi.resetModules()
    const stub = installThreeStub()
    const { generateOrbSpecifications, createOrbField } = await import('./lightOrbs')
    const specs = generateOrbSpecifications({
      seed: 7,
      fieldSize: 300,
      altitudeRange: { min: 5, max: 15 },
      radiusRange: { min: 1, max: 2 },
      count: 2,
    })
    const { group } = createOrbField(specs)
    //1.- Verify each spec creates a matching point light within the group hierarchy.
    const lightCount = group.children.filter((child) => child.type === 'PointLight').length
    expect(lightCount).toBe(specs.length)
    expect(stub.PointLight).toBeDefined()
  })
})

