import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

import { disposeVehicleMesh } from '../../../app/gameplay/planetSandbox/PlanetaryMapPanel'

describe('disposeVehicleMesh', () => {
  it('disposes geometry and a single material instance', () => {
    const geometryDispose = vi.fn()
    const materialDispose = vi.fn()
    const geometry = { dispose: geometryDispose } as unknown as THREE.BufferGeometry
    const material = { dispose: materialDispose } as unknown as THREE.Material
    const mesh = {
      geometry,
      material,
    } as unknown as THREE.Mesh<THREE.BufferGeometry, THREE.Material>

    disposeVehicleMesh(mesh)

    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
  })

  it('disposes each material when the mesh owns multiple materials', () => {
    const geometryDispose = vi.fn()
    const firstMaterialDispose = vi.fn()
    const secondMaterialDispose = vi.fn()
    const geometry = { dispose: geometryDispose } as unknown as THREE.BufferGeometry
    const firstMaterial = { dispose: firstMaterialDispose } as unknown as THREE.Material
    const secondMaterial = { dispose: secondMaterialDispose } as unknown as THREE.Material
    const mesh = {
      geometry,
      material: [firstMaterial, secondMaterial],
    } as unknown as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.Material | THREE.Material[]
    >

    disposeVehicleMesh(mesh)

    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(firstMaterialDispose).toHaveBeenCalledTimes(1)
    expect(secondMaterialDispose).toHaveBeenCalledTimes(1)
  })
})
