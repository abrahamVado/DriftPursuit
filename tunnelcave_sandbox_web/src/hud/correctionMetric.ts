import type { CorrectionEventDetail } from '../networking/WebSocketClient'
import { HudMetric } from './hudMetric'

export interface CorrectionMetricOptions {
  //1.- Client surfaces correction events for reconciliation telemetry.
  client: EventTarget
  //2.- Window length determines how long corrections remain in the rolling count.
  windowMs?: number
  //3.- Optional clock injection for deterministic tests.
  now?: () => number
}

export class CorrectionMetric {
  private readonly metric: HudMetric
  private readonly corrections: number[] = []
  private readonly windowMs: number
  private readonly now: () => number
  private readonly listener: (event: Event) => void
  private readonly timer: number
  private readonly client: EventTarget

  constructor(root: HTMLElement, options: CorrectionMetricOptions) {
    this.client = options.client
    this.windowMs = Math.max(1000, options.windowMs ?? 60_000)
    this.now = options.now ?? (() => Date.now())
    this.metric = new HudMetric(root, {
      label: 'Corrections',
      description: 'Authoritative corrections in the last minute',
      initialValue: '0',
    })
    this.listener = (event: Event) => {
      const detail = (event as CustomEvent<CorrectionEventDetail>).detail
      this.corrections.push(this.now())
      this.trim()
      this.metric.update(String(this.corrections.length))
    }
    options.client.addEventListener('correction', this.listener as EventListener)
    this.timer = window.setInterval(() => {
      this.trim()
      this.metric.update(String(this.corrections.length))
    }, Math.min(this.windowMs / 4, 5_000))
  }

  dispose(): void {
    //1.- Release timers and listeners so repeated instantiations remain lightweight.
    this.client.removeEventListener('correction', this.listener as EventListener)
    window.clearInterval(this.timer)
  }

  private trim(): void {
    //1.- Drop corrections outside the rolling window while preserving order.
    const cutoff = this.now() - this.windowMs
    while (this.corrections.length > 0 && this.corrections[0] < cutoff) {
      this.corrections.shift()
    }
  }
}
