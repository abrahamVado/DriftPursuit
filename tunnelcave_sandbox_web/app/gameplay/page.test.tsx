import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./BattlefieldCanvas', () => ({
  __esModule: true,
  default: ({ playerName, vehicleId, sessionId }: { playerName: string; vehicleId: string; sessionId: string }) => (
    <div data-testid="mock-canvas">
      {playerName}-{vehicleId}-{sessionId}
    </div>
  ),
}))

describe('GameplayPage', () => {
  beforeEach(() => {
    //1.- Reset the DOM between scenarios to avoid leaking rendered components or validation states.
    document.body.innerHTML = ''
  })

  it('renders the join call to action by default', async () => {
    const { default: GameplayPage } = await import('./page')
    render(<GameplayPage />)
    expect(screen.getByTestId('join-button').textContent).toContain('Join Battle')
    expect(screen.queryByTestId('lobby-card')).toBeNull()
  })

  it('reveals lobby controls after joining', async () => {
    const { default: GameplayPage } = await import('./page')
    render(<GameplayPage />)
    fireEvent.click(screen.getByTestId('join-button'))
    expect(screen.queryByTestId('lobby-card')).not.toBeNull()
    expect(screen.getAllByRole('button', { name: /ARROWHEAD|AURORA|DUSKFALL|STEELWING/ })).toHaveLength(4)
  })

  it('validates that a pilot name is supplied before launching', async () => {
    const { default: GameplayPage } = await import('./page')
    render(<GameplayPage />)
    fireEvent.click(screen.getByTestId('join-button'))
    fireEvent.click(screen.getByTestId('launch-button'))
    expect(screen.getByTestId('name-error').textContent).toMatch(/enter a pilot name/i)
    expect(screen.queryByTestId('battle-stage')).toBeNull()
  })

  it('mounts the battlefield when launch conditions are satisfied', async () => {
    const { default: GameplayPage } = await import('./page')
    render(<GameplayPage />)
    fireEvent.click(screen.getByTestId('join-button'))
    const input = screen.getByTestId('pilot-name-field') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Nova' } })
    fireEvent.click(screen.getByTestId('vehicle-aurora'))
    fireEvent.click(screen.getByTestId('launch-button'))
    expect(screen.queryByTestId('battle-stage')).not.toBeNull()
    expect(screen.getByTestId('mock-canvas').textContent).toContain('Nova-aurora-pilot')
  })
})

