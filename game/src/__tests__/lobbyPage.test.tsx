import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LobbyPage from '@/app/page'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push })
}))

//1.- Ensure the submission guard stops the user from launching without a callsign.
describe('LobbyPage validation', () => {
  beforeEach(() => {
    push.mockClear()
  })

  it('blocks submission when the pilot name is empty', () => {
    render(<LobbyPage />)

    const button = screen.getByRole('button', { name: /enter hangar/i })
    fireEvent.click(button)

    expect(screen.getByRole('alert').textContent).toMatch(/please enter a pilot name/i)
    expect(push).not.toHaveBeenCalled()
  })

  it('accepts valid input and forwards the selection to gameplay', () => {
    render(<LobbyPage />)

    const nameField = screen.getByPlaceholderText(/rookie pilot/i)
    fireEvent.change(nameField, { target: { value: '  Nova   Prime  ' } })

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'icosahedron' } })

    const button = screen.getByRole('button', { name: /enter hangar/i })
    fireEvent.click(button)

    expect(push).toHaveBeenCalledWith('/gameplay?pilot=Nova+Prime&vehicle=icosahedron')
  })
})
