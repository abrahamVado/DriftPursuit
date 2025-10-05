import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SessionLaunchPanel from './SessionLaunchPanel'

describe('SessionLaunchPanel', () => {
  const originalClipboard = navigator.clipboard

  beforeEach(() => {
    //1.- Reset spies and stub the clipboard API so copy interactions can be asserted.
    vi.restoreAllMocks()
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  afterEach(() => {
    //1.- Ensure mounted trees are removed and globals restored after each scenario.
    cleanup()
    Object.assign(navigator, { clipboard: originalClipboard })
  })

  it('propagates pilot and vehicle changes then triggers the start callback', () => {
    const onPlayerNameChange = vi.fn()
    const onVehicleIdChange = vi.fn()
    const onStart = vi.fn()

    render(
      <SessionLaunchPanel
        playerName=""
        vehicleId="arrowhead"
        onPlayerNameChange={onPlayerNameChange}
        onVehicleIdChange={onVehicleIdChange}
        onStart={onStart}
        shareUrl="http://localhost:3000/?vehicle=arrowhead"
      />,
    )

    const nameInput = screen.getByTestId('pilot-name-input') as HTMLInputElement
    const vehicleSelect = screen.getByTestId('vehicle-select') as HTMLSelectElement
    const startButton = screen.getByTestId('start-session-button') as HTMLButtonElement

    fireEvent.change(nameInput, { target: { value: 'Nova Seeker' } })
    fireEvent.change(vehicleSelect, { target: { value: 'aurora' } })
    fireEvent.click(startButton)

    expect(onPlayerNameChange).toHaveBeenCalledWith('Nova Seeker')
    expect(onVehicleIdChange).toHaveBeenCalledWith('aurora')
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('copies the share URL to the clipboard and surfaces confirmation feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(
      <SessionLaunchPanel
        playerName="Nova"
        vehicleId="aurora"
        onPlayerNameChange={() => {}}
        onVehicleIdChange={() => {}}
        onStart={() => {}}
        shareUrl="http://localhost:3000/?pilot=Nova&vehicle=aurora"
      />,
    )

    const copyButton = screen.getByTestId('copy-share-url') as HTMLButtonElement

    fireEvent.click(copyButton)

    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/?pilot=Nova&vehicle=aurora')
    const feedback = await screen.findByTestId('copy-feedback')
    expect(feedback.textContent ?? '').toContain('copied')
  })

  it('warns when attempting to copy without a configured share URL', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(
      <SessionLaunchPanel
        playerName=""
        vehicleId="arrowhead"
        onPlayerNameChange={() => {}}
        onVehicleIdChange={() => {}}
        onStart={() => {}}
      />,
    )

    const copyButton = screen.getByTestId('copy-share-url') as HTMLButtonElement

    fireEvent.click(copyButton)

    expect(warnSpy).not.toHaveBeenCalled()
    const feedback = screen.getByTestId('copy-feedback')
    expect(feedback.textContent ?? '').toContain('unavailable')
  })
})
