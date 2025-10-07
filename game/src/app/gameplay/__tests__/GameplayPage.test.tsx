import React from 'react'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const useSearchParamsMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useSearchParams: useSearchParamsMock
}))

const initGameMock = vi.hoisted(() =>
  vi.fn(() => ({
    api: {
      ingestWorldDiff: vi.fn(),
      sampleIntent: vi.fn(),
      actions: {},
      sampleTransforms: vi.fn(),
      getState: vi.fn(),
      samplePresence: vi.fn(),
      ingestPresenceSnapshot: vi.fn(),
      removeRemoteVehicle: vi.fn()
    },
    dispose: vi.fn()
  }))
)

vi.mock('@/engine/bootstrap', () => ({
  initGame: initGameMock,
  DEFAULT_SCENE_OPTS: {}
}))

const createBrokerClientMock = vi.hoisted(() =>
  vi.fn(() => ({
    onWorldDiff: vi.fn(() => vi.fn()),
    onWorldStatus: vi.fn(() => vi.fn()),
    sendIntent: vi.fn(),
    close: vi.fn()
  }))
)

vi.mock('@/lib/brokerClient', () => ({
  createBrokerClient: createBrokerClientMock
}))

const createPilotProfileMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/pilotProfile', () => ({
  createPilotProfile: createPilotProfileMock
}))

const createPresenceChannelMock = vi.hoisted(() =>
  vi.fn(() => ({
    subscribe: vi.fn(() => vi.fn()),
    publish: vi.fn(),
    announceDeparture: vi.fn(),
    close: vi.fn()
  }))
)

vi.mock('@/lib/presenceChannel', () => ({
  createPresenceChannel: createPresenceChannelMock
}))

vi.mock('@/components/HUD', () => ({
  HUD: () => <div data-testid="hud" />
}))

vi.mock('@/components/LoadingOverlay', () => ({
  LoadingOverlay: () => <div data-testid="loading-overlay" />
}))

import GameplayPage from '../page'

describe('GameplayPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('creates the broker client with the derived pilot profile', async () => {
    const params = new URLSearchParams('pilot=Ada&vehicle=Falcon')
    useSearchParamsMock.mockReturnValue(params as unknown as URLSearchParams)

    const derivedProfile = {
      clientId: 'pilot-123',
      name: 'Ada Raven',
      vehicle: 'Falcon'
    }
    createPilotProfileMock.mockReturnValue(derivedProfile)

    render(<GameplayPage />)

    expect(createPilotProfileMock).toHaveBeenCalledWith({
      name: 'Ada',
      vehicle: 'Falcon'
    })

    await waitFor(() => {
      expect(createBrokerClientMock).toHaveBeenCalledWith({
        clientId: derivedProfile.clientId,
        pilotProfile: {
          name: derivedProfile.name,
          vehicle: derivedProfile.vehicle
        }
      })
    })
  })
})
