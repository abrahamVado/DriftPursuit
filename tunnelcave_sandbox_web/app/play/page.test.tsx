import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fullScreenSessionMock = vi.fn(() => null)

vi.mock('../components/FullScreenSession', () => ({
  __esModule: true,
  default: fullScreenSessionMock,
}))

describe('PlayPage', () => {
  beforeEach(() => {
    //1.- Reset mock invocations before each scenario so expectations stay isolated.
    fullScreenSessionMock.mockClear()
  })

  it('passes search parameters to the full-screen session component', async () => {
    const { default: PlayPage } = await import('./page')
    const element = await PlayPage({
      searchParams: Promise.resolve({ pilot: 'Nova Seeker', vehicle: 'aurora' }),
    })
    expect(React.isValidElement(element)).toBe(true)
    if (React.isValidElement(element)) {
      expect(element.type).toBe(fullScreenSessionMock)
      expect(element.props).toEqual({ pilotName: 'Nova Seeker', vehicleId: 'aurora' })
    }
  })

  it('defaults to arrowhead when an unknown vehicle is provided', async () => {
    const { default: PlayPage } = await import('./page')
    const element = await PlayPage({
      searchParams: Promise.resolve({ pilot: 'Nova', vehicle: 'unknown' }),
    })
    expect(React.isValidElement(element)).toBe(true)
    if (React.isValidElement(element)) {
      expect(element.type).toBe(fullScreenSessionMock)
      expect(element.props).toEqual({ pilotName: 'Nova', vehicleId: 'arrowhead' })
    }
  })
})
