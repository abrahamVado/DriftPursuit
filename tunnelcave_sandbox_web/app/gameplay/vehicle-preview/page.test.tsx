import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { VEHICLE_DESCRIPTIONS, VEHICLE_IDS, VEHICLE_LABELS } from '../vehicles'

vi.mock('./VehiclePreviewCanvas', () => ({
  __esModule: true,
  default: ({ vehicleId }: { vehicleId: string }) => <div data-testid={`mock-canvas-${vehicleId}`}>{vehicleId}</div>,
}))

describe('VehiclePreviewPage', () => {
  it('displays a card for every registered vehicle', async () => {
    const { default: VehiclePreviewPage } = await import('./page')
    render(<VehiclePreviewPage />)
    //1.- Ensure each vehicle has a dedicated preview card.
    VEHICLE_IDS.forEach((vehicleId) => {
      const card = screen.getByTestId(`vehicle-preview-card-${vehicleId}`)
      expect(card).toBeTruthy()
      expect(card.textContent).toContain(VEHICLE_LABELS[vehicleId])
      expect(card.textContent).toContain(VEHICLE_DESCRIPTIONS[vehicleId])
    })
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(VEHICLE_IDS.length)
  })

  it('delegates rendering to the preview canvas component', async () => {
    const { default: VehiclePreviewPage } = await import('./page')
    render(<VehiclePreviewPage />)
    //1.- Verify the canvas stub is instantiated for each vehicle option.
    VEHICLE_IDS.forEach((vehicleId) => {
      expect(screen.getByTestId(`mock-canvas-${vehicleId}`)).toBeTruthy()
    })
  })
})
