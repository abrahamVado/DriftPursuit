import { describe, expect, it, vi } from 'vitest'
import { createPresenceChannel, type PresenceEnvelope } from '@/lib/presenceChannel'
import type { PresenceSnapshot } from '@/engine/bootstrap'

type Handler = (event: { data: PresenceEnvelope }) => void

class StubChannel {
  private handlers = new Set<Handler>()

  constructor(private readonly name: string, private readonly bus: Map<string, Set<StubChannel>>) {
    //1.- Register this instance in the shared bus so other channels can receive broadcast messages.
    if (!this.bus.has(this.name)) {
      this.bus.set(this.name, new Set())
    }
    this.bus.get(this.name)!.add(this)
  }

  postMessage(data: PresenceEnvelope) {
    //1.- Fan the payload out to every peer subscribed to the same channel name.
    const peers = this.bus.get(this.name)
    if (!peers) return
    for (const peer of peers) {
      if (peer === this) continue
      peer.dispatch(data)
    }
  }

  addEventListener(_: 'message', listener: Handler) {
    //1.- Store listener references so we can deliver broadcasts synchronously during tests.
    this.handlers.add(listener)
  }

  removeEventListener(_: 'message', listener: Handler) {
    //1.- Support clean-up by dropping the reference from the handler registry.
    this.handlers.delete(listener)
  }

  close() {
    //1.- Evict this instance from the bus to avoid leaking listeners between test cases.
    this.bus.get(this.name)?.delete(this)
    this.handlers.clear()
  }

  private dispatch(data: PresenceEnvelope) {
    //1.- Deliver the envelope synchronously for deterministic assertions.
    const event = { data }
    for (const handler of this.handlers) {
      handler(event)
    }
  }
}

const snapshot: PresenceSnapshot = {
  vehicle_id: 'veh-alpha',
  position: { x: 1, y: 2, z: 3 },
  orientation: { yaw_deg: 10, pitch_deg: 20, roll_deg: 30 }
}

describe('createPresenceChannel', () => {
  it('broadcasts presence updates to other subscribers', () => {
    const bus = new Map<string, Set<StubChannel>>()
    const factory = (name: string) => new StubChannel(name, bus)
    const sender = createPresenceChannel({ clientId: 'alpha', now: () => 42, factory })
    const receiver = createPresenceChannel({ clientId: 'beta', now: () => 42, factory })
    const listener = vi.fn()
    receiver.subscribe(listener)

    sender.publish(snapshot)

    expect(listener).toHaveBeenCalledTimes(1)
    const message = listener.mock.calls[0][0] as PresenceEnvelope
    expect(message.type).toBe('update')
    expect(message.snapshot.vehicle_id).toBe('veh-alpha')
    sender.close()
    receiver.close()
  })

  it('broadcasts departures so peers can despawn remote vehicles', () => {
    const bus = new Map<string, Set<StubChannel>>()
    const factory = (name: string) => new StubChannel(name, bus)
    const sender = createPresenceChannel({ clientId: 'alpha', now: () => 77, factory })
    const receiver = createPresenceChannel({ clientId: 'beta', now: () => 77, factory })
    const listener = vi.fn()
    receiver.subscribe(listener)

    sender.announceDeparture('veh-alpha')

    expect(listener).toHaveBeenCalledTimes(1)
    const message = listener.mock.calls[0][0] as PresenceEnvelope
    expect(message.type).toBe('leave')
    expect(message.vehicleId).toBe('veh-alpha')
    sender.close()
    receiver.close()
  })

  it('ignores invalid snapshots and keeps listeners silent', () => {
    const bus = new Map<string, Set<StubChannel>>()
    const factory = (name: string) => new StubChannel(name, bus)
    const sender = createPresenceChannel({ clientId: 'alpha', factory })
    const receiver = createPresenceChannel({ clientId: 'beta', factory })
    const listener = vi.fn()
    receiver.subscribe(listener)

    sender.publish(null)
    sender.publish({
      vehicle_id: '',
      position: { x: Number.NaN, y: 0, z: 0 },
      orientation: { yaw_deg: 0, pitch_deg: 0, roll_deg: 0 }
    })

    expect(listener).not.toHaveBeenCalled()
    sender.close()
    receiver.close()
  })
})
