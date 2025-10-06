import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SHARED_WORLD_SEED } from './worldLobby'

const generateBattlefieldMock = vi.fn(() => ({
  fieldSize: 320,
  spawnPoint: { x: 0, y: 0, z: 0 },
}) as unknown)

vi.mock('./generateBattlefield', () => ({
  generateBattlefield: (...args: unknown[]) => generateBattlefieldMock(...args),
}))

vi.mock('./BattlefieldCanvas', () => ({
  __esModule: true,
  default: ({ playerName, vehicleId, sessionId }: { playerName: string; vehicleId: string; sessionId: string }) => (
    <div data-testid="mock-canvas">
      {playerName}-{vehicleId}-{sessionId}
    </div>
  ),
}))

vi.mock('./planetSandbox/PlanetaryMapPanel', () => ({
  __esModule: true,
  default: ({ battlefield }: { battlefield: unknown }) => (
    <div data-testid="mock-planet-panel">planet-panel-{Boolean(battlefield)}</div>
  ),
}))

describe('GameplayPage', () => {
  beforeEach(() => {
    //1.- Reset the DOM between scenarios to avoid leaking rendered components or validation states.
    document.body.innerHTML = ''
    generateBattlefieldMock.mockClear()
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

  it('mounts the battlefield and planet panel when launch conditions are satisfied', async () => {
    const { default: GameplayPage } = await import('./page')
    render(<GameplayPage />)
    fireEvent.click(screen.getByTestId('join-button'))
    const input = screen.getByTestId('pilot-name-field') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Nova' } })
    fireEvent.click(screen.getByTestId('vehicle-aurora'))
    fireEvent.click(screen.getByTestId('launch-button'))
    expect(screen.queryByTestId('battle-stage')).not.toBeNull()
    expect(screen.getByTestId('mock-canvas').textContent).toContain('Nova-aurora-pilot')
    //2.- The sandbox panel should render alongside the battlefield layout.
    expect(screen.queryByTestId('mock-planet-panel')).not.toBeNull()
  })

  it('generates the shared battlefield using the global world seed', async () => {
    const { default: GameplayPage } = await import('./page')
    render(<GameplayPage />)
    //1.- The memoised generator must resolve with the shared seed so every player sees the same terrain.
    expect(generateBattlefieldMock).toHaveBeenCalledWith(SHARED_WORLD_SEED)
  })
})
