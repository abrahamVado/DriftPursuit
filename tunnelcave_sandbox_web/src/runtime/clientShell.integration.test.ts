import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EventStreamClient, MemoryEventStore } from '@client/eventStream'
import type { CorrectionEventDetail, ConnectionStatus } from '../networking/WebSocketClient'

//1.- Provide a test double exposing minimal telemetry controls for HUD rendering assertions.
class StubSessionClient extends EventTarget {
  private status: ConnectionStatus = 'disconnected'
  private bufferMs = 0

  getConnectionStatus(): ConnectionStatus {
    return this.status
  }

  getPlaybackBufferMs(): number {
    return this.bufferMs
  }

  setStatus(status: ConnectionStatus): void {
    this.status = status
    this.dispatchEvent(new CustomEvent<ConnectionStatus>('status', { detail: status }))
  }

  setBufferMs(bufferMs: number): void {
    this.bufferMs = bufferMs
  }

  emitCorrection(tickId: number): void {
    const detail: CorrectionEventDetail = {
      entityId: 'alpha',
      positionError: 1,
      orientationError: 1,
      tickId,
    }
    this.dispatchEvent(new CustomEvent('correction', { detail }))
  }
}

//2.- Preserve the original readyState descriptor so tests can override and restore it deterministically.
const originalReadyStateDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'readyState')

describe('clientShell integration', () => {
  beforeEach(() => {
    //3.- Reset module state and fake timers so each spec starts from a clean slate.
    vi.resetModules()
    vi.useFakeTimers()
    document.body.innerHTML = ''
    if (originalReadyStateDescriptor) {
      Object.defineProperty(document, 'readyState', originalReadyStateDescriptor)
    }
  })

  afterEach(() => {
    //4.- Restore timers and DOM shims so other suites execute against browser defaults.
    vi.useRealTimers()
    if (originalReadyStateDescriptor) {
      Object.defineProperty(document, 'readyState', originalReadyStateDescriptor)
    }
    document.body.innerHTML = ''
  })

  it('renders live HUD metrics from a world session', async () => {
    //5.- Prepare the DOM scaffolding and mark the document as parsed for immediate mounting.
    document.body.innerHTML = [
      '<div id="canvas-root"></div>',
      '<div id="hud-root"></div>',
    ].join('')
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' })

    const { mountClientShell, unmountClientShell } = await import('./clientShell')

    const sent: string[] = []
    const sessionClient = new StubSessionClient()
    //6.- Instantiate the event stream client backed by an in-memory store to capture acknowledgements.
    const eventStream = new EventStreamClient(
      'hud-test',
      { send: (data: string) => sent.push(data) },
      new MemoryEventStore(),
    )
    const sessionDispose = vi.fn()
    const createWorldSession = vi.fn(async () => ({
      client: sessionClient,
      eventStream,
      dispose: sessionDispose,
    }))

    const mounted = await mountClientShell({ createWorldSession })
    expect(mounted).toBe('active')

    const metrics = document.querySelectorAll('.hud-metric')
    expect(metrics).toHaveLength(3)

    //7.- Drive telemetry updates so the HUD surfaces live connection and buffer metrics.
    sessionClient.setStatus('connected')
    const connectionValue = metrics[0]?.querySelector('.hud-metric__value')?.textContent
    expect(connectionValue).toBe('Online')

    sessionClient.setBufferMs(1_500)
    vi.advanceTimersByTime(600)
    const playbackValue = metrics[1]?.querySelector('.hud-metric__value')?.textContent
    expect(playbackValue).toBe('1.5 s')

    //8.- Emit a correction event so the reconciliation metric reflects broker feedback.
    vi.setSystemTime(new Date(10_000))
    sessionClient.emitCorrection(42)
    vi.advanceTimersByTime(200)
    const correctionValue = metrics[2]?.querySelector('.hud-metric__value')?.textContent
    expect(correctionValue).toBe('1')

    //9.- Feed scoreboard lifecycle events and confirm the overlay renders rows while acknowledging frames.
    eventStream.ingest([
      {
        sequence: 1,
        kind: 'lifecycle',
        payload: {
          schemaVersion: '1.0.0',
          eventId: 'score-1',
          occurredAtMs: 10_000,
          type: 5,
          primaryEntityId: 'pilot',
          relatedEntityIds: [],
          metadata: {
            score_player_id: 'pilot',
            score_display_name: 'Pilot One',
            score_kills: '4',
            score_assists: '2',
          },
        },
      },
    ])
    vi.advanceTimersByTime(250)
    const table = document.querySelector('.hud-scoreboard__table')
    expect(table?.textContent).toContain('Pilot One')
    expect(table?.textContent).toContain('4')
    expect(sent).toContainEqual(
      JSON.stringify({ type: 'event_ack', subscriber: 'hud-test', sequence: 1 })
    )

    //10.- Tearing down the shell should dispose resources exposed by the world session.
    unmountClientShell()
    expect(sessionDispose).toHaveBeenCalledTimes(1)
  })
})
