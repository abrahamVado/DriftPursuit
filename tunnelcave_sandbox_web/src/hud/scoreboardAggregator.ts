import type { GameEvent } from '../../../typescript-client/src/generated/events'
import { EventStreamClient, type EventEnvelope } from '../../../typescript-client/src/eventStream'

export interface ScoreboardEntry {
  //1.- Stable identifier used for deduplicating rows.
  playerId: string
  //2.- Friendly display name shown in the overlay.
  displayName: string
  //3.- Numeric metrics keyed by canonical metric identifiers.
  metrics: Record<string, number>
  //4.- Last broker timestamp propagated with the update.
  lastUpdateMs: number
}

export interface ScoreboardAggregatorOptions {
  //1.- Optional clock override for deterministic tests.
  now?: () => number
}

const SCORE_PREFIX = 'score_'
const STRING_KEYS = new Set(['score_player_id', 'score_display_name', 'score_name'])

export class ScoreboardAggregator extends EventTarget {
  private readonly entries = new Map<string, ScoreboardEntry>()
  private readonly metrics = new Set<string>()
  private readonly now: () => number

  constructor(options: ScoreboardAggregatorOptions = {}) {
    super()
    this.now = options.now ?? (() => Date.now())
  }

  ingest(event: GameEvent): void {
    //1.- Only lifecycle score updates propagate into the scoreboard snapshot.
    if (event.type !== 5 /* EVENT_TYPE_SCORE_UPDATE */) {
      return
    }
    const metadata = event.metadata ?? {}
    const playerId = metadata['score_player_id'] ?? event.primaryEntityId
    if (!playerId) {
      return
    }
    const displayName = metadata['score_display_name'] ?? metadata['score_name'] ?? playerId
    const metrics: Record<string, number> = {}
    for (const [key, value] of Object.entries(metadata)) {
      if (!key.startsWith(SCORE_PREFIX) || STRING_KEYS.has(key)) {
        continue
      }
      const metricKey = key.substring(SCORE_PREFIX.length)
      const numericValue = Number.parseFloat(value)
      if (Number.isNaN(numericValue)) {
        continue
      }
      metrics[metricKey] = numericValue
      this.metrics.add(metricKey)
    }
    const lastUpdateMs = event.occurredAtMs || this.now()
    const existing = this.entries.get(playerId)
    const merged: ScoreboardEntry = {
      playerId,
      displayName,
      metrics: { ...(existing?.metrics ?? {}), ...metrics },
      lastUpdateMs,
    }
    this.entries.set(playerId, merged)
    this.publish()
  }

  listEntries(): ScoreboardEntry[] {
    //1.- Materialise a stable ordering that prefers higher scoring players first.
    const values = Array.from(this.entries.values())
    values.sort((a, b) => {
      const aMax = maxMetricValue(a.metrics)
      const bMax = maxMetricValue(b.metrics)
      if (aMax !== bMax) {
        return bMax - aMax
      }
      if (a.displayName !== b.displayName) {
        return a.displayName.localeCompare(b.displayName)
      }
      return a.playerId.localeCompare(b.playerId)
    })
    return values
  }

  listMetricKeys(): string[] {
    //1.- Expose the union of metrics so the overlay can build the table header.
    return Array.from(this.metrics).sort((a, b) => a.localeCompare(b))
  }

  bindStream(stream: EventStreamClient, intervalMs = 200): () => void {
    //1.- Poll the event stream backlog until exhausted, acknowledging processed frames.
    const timer = window.setInterval(() => {
      let processed = false
      while (true) {
        const next = stream.nextPending()
        if (!next) {
          break
        }
        if (isGameEventEnvelope(next)) {
          this.ingest(next.payload)
        }
        stream.ackLatest()
        processed = true
      }
      if (!processed) {
        return
      }
    }, Math.max(50, intervalMs))
    return () => window.clearInterval(timer)
  }

  private publish(): void {
    //1.- Emit a CustomEvent so DOM overlays can reactively render.
    this.dispatchEvent(new CustomEvent('entries', { detail: this.listEntries() }))
  }
}

function maxMetricValue(metrics: Record<string, number>): number {
  //1.- Determine the dominant metric to drive descending sorting.
  let max = -Infinity
  for (const value of Object.values(metrics)) {
    if (value > max) {
      max = value
    }
  }
  return Number.isFinite(max) ? max : 0
}

function isGameEventEnvelope(envelope: EventEnvelope): envelope is EventEnvelope & { payload: GameEvent } {
  //1.- Defensive runtime guard verifying the envelope carries a score update payload.
  if (!envelope || envelope.kind !== 'lifecycle') {
    return false
  }
  const payload = envelope.payload as Partial<GameEvent>
  return typeof payload === 'object' && payload !== null && typeof payload.type === 'number'
}
