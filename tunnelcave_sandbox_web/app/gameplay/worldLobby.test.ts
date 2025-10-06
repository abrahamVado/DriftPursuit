import { beforeEach, describe, expect, it } from 'vitest'

import { createWorldLobby, SHARED_WORLD_ID, type WorldPeerSnapshot } from './worldLobby'

type Listener = (event: { data: unknown }) => void

const channelRegistry = new Map<string, Set<MemoryChannel>>()

class MemoryChannel {
  //1.- Preserve listeners so broadcast delivery remains synchronous for the tests.
  private listeners = new Set<Listener>()

  constructor(private readonly name: string) {
    const bucket = channelRegistry.get(name)
    if (bucket) {
      bucket.add(this)
    } else {
      channelRegistry.set(name, new Set([this]))
    }
  }

  postMessage(message: unknown) {
    //1.- Fan out the message to every subscriber on the same logical channel.
    const peers = channelRegistry.get(this.name)
    if (!peers) {
      return
    }
    peers.forEach((peer) => {
      if (peer === this) {
        return
      }
      peer.deliver(message)
    })
  }

  addEventListener(type: 'message', listener: Listener) {
    //1.- Register callbacks so the lobby can respond to announcements and state updates.
    if (type !== 'message') {
      return
    }
    this.listeners.add(listener)
  }

  removeEventListener(type: 'message', listener: Listener) {
    //1.- Remove listeners when the lobby disposes to avoid leaking memory between tests.
    if (type !== 'message') {
      return
    }
    this.listeners.delete(listener)
  }

  close() {
    //1.- Detach the channel from the registry mimicking BroadcastChannel.close semantics.
    this.listeners.clear()
    channelRegistry.get(this.name)?.delete(this)
  }

  private deliver(message: unknown) {
    //1.- Invoke each listener with a payload matching the BroadcastChannel event signature.
    this.listeners.forEach((listener) => listener({ data: message }))
  }
}

beforeEach(() => {
  //1.- Reset the registry so each test begins with an isolated in-memory transport.
  channelRegistry.clear()
})

describe('createWorldLobby', () => {
  it('shares presence updates and removes peers that leave the shared world', () => {
    const createChannel = (name: string) => new MemoryChannel(name)
    const lobbyAlpha = createWorldLobby(
      {
        worldId: SHARED_WORLD_ID,
        sessionId: 'alpha',
        name: 'Alpha',
        vehicleId: 'arrowhead',
        spawn: { x: 0, y: 0, z: 0 },
      },
      { createChannel, now: () => 1000, heartbeatIntervalMs: 5000, staleThresholdMs: 15000 },
    )
    const lobbyBravo = createWorldLobby(
      {
        worldId: SHARED_WORLD_ID,
        sessionId: 'bravo',
        name: 'Bravo',
        vehicleId: 'aurora',
        spawn: { x: 10, y: 0, z: 4 },
      },
      { createChannel, now: () => 2000, heartbeatIntervalMs: 5000, staleThresholdMs: 15000 },
    )

    const alphaSnapshots: WorldPeerSnapshot[][] = []
    const bravoSnapshots: WorldPeerSnapshot[][] = []
    const unsubscribeAlpha = lobbyAlpha.subscribe((peers) => {
      alphaSnapshots.push(peers)
    })
    const unsubscribeBravo = lobbyBravo.subscribe((peers) => {
      bravoSnapshots.push(peers)
    })

    lobbyAlpha.updatePresence({ position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } })
    lobbyBravo.updatePresence({ position: { x: 11, y: 0, z: 5 }, velocity: { x: 1, y: 0, z: 1 } })

    const latestSeenByAlpha = alphaSnapshots.at(-1)
    expect(latestSeenByAlpha).toBeDefined()
    expect(latestSeenByAlpha).toHaveLength(1)
    expect(latestSeenByAlpha?.[0].sessionId).toBe('bravo')
    expect(latestSeenByAlpha?.[0].position.x).toBeCloseTo(11)

    const latestSeenByBravo = bravoSnapshots.at(-1)
    expect(latestSeenByBravo).toBeDefined()
    expect(latestSeenByBravo).toHaveLength(1)
    expect(latestSeenByBravo?.[0].sessionId).toBe('alpha')

    lobbyBravo.dispose()

    const postLeaveByAlpha = alphaSnapshots.at(-1)
    expect(postLeaveByAlpha).toBeDefined()
    expect(postLeaveByAlpha).toHaveLength(0)

    unsubscribeAlpha()
    unsubscribeBravo()
    lobbyAlpha.dispose()
  })
})
