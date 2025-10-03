import { describe, expect, it, vi } from 'vitest'

import type { ConnectionStatus, CorrectionEventDetail } from '../networking/WebSocketClient'
import { HudController } from './controller'

declare global {
  interface Window {
    setInterval(handler: TimerHandler, timeout?: number, ...arguments: unknown[]): number
  }
}

class MockClient extends EventTarget {
  private status: ConnectionStatus = 'disconnected'
  private bufferMs = 250

  //1.- getConnectionStatus mirrors the WebSocket client API expected by the controller.
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

describe('HudController', () => {
  it('renders live metrics and toggles the scoreboard overlay', () => {
    //1.- Use fake timers so polling intervals advance deterministically in tests.
    vi.useFakeTimers()
    const root = document.createElement('div')
    document.body.append(root)
    const client = new MockClient()
    const controller = new HudController({ root, client })
    const metrics = root.querySelectorAll('.hud-metric')
    expect(metrics).toHaveLength(3)

    //2.- Connection status metric should react to lifecycle events.
    client.setStatus('connected')
    const connectionValue = metrics[0]?.querySelector('.hud-metric__value')?.textContent
    expect(connectionValue).toBe('Online')

    //3.- Playback buffer metric polls periodically so advance the timer to update the text.
    client.setBufferMs(1500)
    vi.advanceTimersByTime(600)
    const playbackValue = metrics[1]?.querySelector('.hud-metric__value')?.textContent
    expect(playbackValue).toBe('1.5 s')

    //4.- Correction metric increments when reconciliation events fire.
    vi.setSystemTime(10_000)
    client.emitCorrection(1)
    vi.advanceTimersByTime(100)
    const correctionValue = metrics[2]?.querySelector('.hud-metric__value')?.textContent
    expect(correctionValue).toBe('1')

    //5.- Inject scoreboard data and verify the overlay renders dynamic columns.
    controller
      .aggregator()
      .ingest({
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
          score_assists: '3',
        },
      })
    const table = root.querySelector('.hud-scoreboard__table')
    expect(table?.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(table?.textContent).toContain('Pilot One')
    expect(table?.textContent).toContain('4')

    //6.- Scoreboard remains hidden until Tab is pressed.
    const overlay = root.querySelector('.hud-scoreboard') as HTMLElement
    expect(overlay.dataset.visible).not.toBe('true')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    expect(overlay.dataset.visible).toBe('true')

    controller.dispose()
    vi.useRealTimers()
  })
})
