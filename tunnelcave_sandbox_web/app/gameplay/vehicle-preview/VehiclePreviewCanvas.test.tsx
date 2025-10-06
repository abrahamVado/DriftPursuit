import * as THREE from 'three'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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
