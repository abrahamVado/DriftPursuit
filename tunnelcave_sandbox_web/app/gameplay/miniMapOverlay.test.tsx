import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MiniMapOverlay, type MiniMapEntitySnapshot } from './miniMapOverlay'

describe('MiniMapOverlay', () => {
  it('centres the player marker when positioned at the origin', () => {
    render(<MiniMapOverlay fieldSize={200} peers={[]} player={{ x: 0, z: 0 }} />)
    const player = screen.getByTestId('minimap-player')
    expect(player.getAttribute('cx')).toBe('50')
    expect(player.getAttribute('cy')).toBe('50')
  })

  it('renders peer markers with their associated legend entries', () => {
    const peers: MiniMapEntitySnapshot[] = [
      { id: 'wing-1', label: 'Wing One', x: 80, z: -20 },
      { id: 'wing-2', label: 'Wing Two', x: -50, z: 60 },
    ]
    render(<MiniMapOverlay fieldSize={200} peers={peers} player={{ x: 0, z: 0 }} />)
    const markers = screen.getAllByTestId('minimap-peer')
    expect(markers).toHaveLength(2)
    const legend = screen.getByTestId('minimap-legend')
    expect(legend.textContent).toContain('Wing One')
    expect(legend.textContent).toContain('Wing Two')
  })
})
