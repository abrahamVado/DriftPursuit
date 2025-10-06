import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { VEHICLE_IDS, VEHICLE_LABELS } from '../vehicles'

describe('Models3dPage', () => {
  it('lists every available vehicle in the hangar grid', async () => {
    const { default: Models3dPage } = await import('./page')
    render(<Models3dPage />)
    //1.- Ensure the grid wrapper renders so the gallery structure exists for navigation landmarks.
    const grid = screen.getByTestId('models3d-grid')
    expect(grid).toBeTruthy()
    //2.- Confirm each vehicle entry appears exactly once with the expected label.
    VEHICLE_IDS.forEach((vehicleId) => {
      const card = screen.getByTestId(`models3d-${vehicleId}`)
      expect(card).toBeTruthy()
      expect(card.textContent).toContain(VEHICLE_LABELS[vehicleId])
    })
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(VEHICLE_IDS.length)
  })
})
