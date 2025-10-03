import { render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it } from 'vitest'

import InteractionTasks from './InteractionTasks'

describe('InteractionTasks', () => {
  it('lists all required interaction tasks with pending status', () => {
    //1.- Render the checklist so we can assert each task and its default status message.
    render(<InteractionTasks />)
    expect(() => screen.getByRole('heading', { name: 'Interaction readiness checklist' })).not.toThrow()
    const tasks = screen.getAllByRole('listitem')
    expect(tasks).toHaveLength(3)
    expect(screen.getAllByText(/Status: Pending/)).toHaveLength(3)
    expect(() => screen.getByText(/Capture the map overview/)).not.toThrow()
    expect(() => screen.getByText(/Document the available vehicles/)).not.toThrow()
    expect(() => screen.getByText(/Record the control overlay/)).not.toThrow()
  })
})
