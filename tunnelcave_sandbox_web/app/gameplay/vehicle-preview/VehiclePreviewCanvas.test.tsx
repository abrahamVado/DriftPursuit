import * as THREE from 'three'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { isMeshLikeObject } from './VehiclePreviewCanvas'

const createVehicleModelMock = vi.fn(() => new THREE.Group())

vi.mock('../3dmodel/vehicles', () => ({
  createVehicleModel: (...args: unknown[]) => createVehicleModelMock(...args),
}))

describe('VehiclePreviewCanvas', () => {
  it('renders a fallback message when WebGL is unavailable', async () => {
    const { default: VehiclePreviewCanvas } = await import('./VehiclePreviewCanvas')
    render(<VehiclePreviewCanvas vehicleId="arrowhead" />)
    //1.- Validate that test environments lacking WebGL receive a descriptive message instead of crashing.
    const frame = screen.getByTestId('vehicle-preview-arrowhead')
    expect(frame.dataset.webgl).toBe('unavailable')
    expect(frame.textContent).toContain('Interactive preview unavailable in this environment.')
  })
})

describe('isMeshLikeObject', () => {
  it('recognises mesh-derived primitives that expose disposable resources', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    //1.- Confirm the helper acknowledges meshes so cleanup logic can release their buffers and materials.
    expect(isMeshLikeObject(mesh)).toBe(true)
    const geometry = mesh.geometry as { dispose?: () => void }
    if (typeof geometry.dispose === 'function') {
      geometry.dispose()
    }
    const material = mesh.material as { dispose?: () => void }
    if (typeof material.dispose === 'function') {
      material.dispose()
    }
  })

  it('rejects generic scene graph nodes without disposable geometry', () => {
    const object = new THREE.Object3D()
    //1.- Ensure scene graph nodes without geometry are ignored to prevent runtime errors.
    expect(isMeshLikeObject(object)).toBe(false)
  })
})
