import { describe, expect, it, vi } from 'vitest'

import type { GameEvent } from '../../../typescript-client/src/generated/events'
import { EventStreamClient, MemoryEventStore } from '../../../typescript-client/src/eventStream'
import { ScoreboardAggregator } from './scoreboardAggregator'

function createScoreEvent(overrides: Partial<GameEvent> = {}): GameEvent {
  //1.- Provide a deterministic base payload mirroring broker score updates.
  return {
    schemaVersion: '1.0.0',
    eventId: overrides.eventId ?? 'evt-1',
    occurredAtMs: overrides.occurredAtMs ?? 1_000,
    type: overrides.type ?? 5,
    primaryEntityId: overrides.primaryEntityId ?? 'player-1',
    relatedEntityIds: overrides.relatedEntityIds ?? [],
    metadata: overrides.metadata ?? {
      score_player_id: 'player-1',
      score_display_name: 'Alpha',
      score_kills: '3',
      score_assists: '1',
    },
  }
}

describe('ScoreboardAggregator', () => {
  it('aggregates score metadata and emits ordered entries', () => {
    //1.- Ingest two score events and verify the resulting table snapshot ordering.
    const aggregator = new ScoreboardAggregator({ now: () => 2_000 })
    const updates: string[][] = []
    aggregator.addEventListener('entries', (event) => {
      const entries = (event as CustomEvent).detail as ReturnType<typeof aggregator.listEntries>
      updates.push(entries.map((entry) => `${entry.displayName}:${entry.metrics.kills}`))
    })
    aggregator.ingest(createScoreEvent())
    aggregator.ingest(
      createScoreEvent({
        eventId: 'evt-2',
        metadata: {
          score_player_id: 'player-2',
          score_display_name: 'Bravo',
          score_kills: '5',
          score_assists: '2',
        },
      }),
    )
    const entries = aggregator.listEntries()
    expect(entries[0]?.displayName).toBe('Bravo')
    expect(entries[0]?.metrics.kills).toBe(5)
    expect(entries[1]?.displayName).toBe('Alpha')
    expect(updates.length).toBe(2)
    expect(aggregator.listMetricKeys()).toEqual(['assists', 'kills'])
  })

  it('binds to an event stream and drains pending events', () => {
    //1.- Leverage the real event stream client to ensure polling works under timers.
    vi.useFakeTimers()
    const sent: string[] = []
    const stream = new EventStreamClient(
      'hud',
      { send: (data: string) => sent.push(data) },
      new MemoryEventStore(),
    )
    const aggregator = new ScoreboardAggregator()
    aggregator.bindStream(stream, 100)
    stream.ingest([
      {
        sequence: 1,
        kind: 'lifecycle',
        payload: createScoreEvent({ eventId: 'evt-stream' }),
      },
    ])
    vi.advanceTimersByTime(150)
    const entries = aggregator.listEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.displayName).toBe('Alpha')
    expect(sent).toContainEqual(
      JSON.stringify({ type: 'event_ack', subscriber: 'hud', sequence: 1 }),
    )
    vi.useRealTimers()
  })
})
