import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SHARED_WORLD_SEED } from '../worldLobby'

const generateBattlefieldMock = vi.fn(() => ({
  fieldSize: 400,
  spawnPoint: { x: 0, y: 0, z: 0 },
}) as unknown)

vi.mock('../generateBattlefield', () => ({
  generateBattlefield: (...args: unknown[]) => generateBattlefieldMock(...args),
}))

vi.mock('../BattlefieldCanvas', () => ({
  __esModule: true,
  default: ({ playerName, vehicleId }: { playerName: string; vehicleId: string }) => (
    <div data-testid="mock-world-canvas">
      {playerName}-{vehicleId}
    </div>
  ),
}))

describe('WorldExplorerPage', () => {
  it('mounts the battlefield immediately with the spectator defaults', async () => {
    const { default: WorldExplorerPage } = await import('./page')
    render(<WorldExplorerPage />)
    //1.- Confirm the sandbox renders without prompting for player metadata.
    expect(screen.getByTestId('world-explorer-page')).toBeTruthy()
    expect(screen.getByTestId('mock-world-canvas').textContent).toContain('Cavern Explorer')
  })

  it('shares the procedural terrain seed with the main lobby', async () => {
    const { default: WorldExplorerPage } = await import('./page')
    render(<WorldExplorerPage />)
    //1.- Ensure the same battlefield seed is used so exploration matches the combat environment.
    expect(generateBattlefieldMock).toHaveBeenCalledWith(SHARED_WORLD_SEED)
  })
})
