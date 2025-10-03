import { HudMetric } from './hudMetric'

export interface PlaybackMetricOptions {
  //1.- Source client exposes playback buffer duration sampling.
  client: { getPlaybackBufferMs(): number }
  //2.- Interval controls how frequently the HUD polls for updates.
  intervalMs?: number
}

export class PlaybackMetric {
  private readonly metric: HudMetric
  private readonly timer: number
  private readonly client: PlaybackMetricOptions['client']

  constructor(root: HTMLElement, options: PlaybackMetricOptions) {
    this.client = options.client
    //1.- Render initial buffer value so the HUD reflects startup conditions.
    const initialMs = this.client.getPlaybackBufferMs()
    this.metric = new HudMetric(root, {
      label: 'Buffer',
      description: 'Snapshot playback delay',
      initialValue: formatBuffer(initialMs),
    })
    const intervalMs = Math.max(100, options.intervalMs ?? 500)
    this.timer = window.setInterval(() => {
      const bufferMs = this.client.getPlaybackBufferMs()
      this.metric.update(formatBuffer(bufferMs))
    }, intervalMs)
  }

  dispose(): void {
    //1.- Clear the polling timer so tests and teardown flows can exit promptly.
    window.clearInterval(this.timer)
  }
}

function formatBuffer(bufferMs: number): string {
  //1.- Express buffer duration in milliseconds with one decimal seconds as context.
  const safeMs = Number.isFinite(bufferMs) ? bufferMs : 0
  if (safeMs >= 1_000) {
    return `${(safeMs / 1000).toFixed(1)} s`
  }
  return `${Math.round(safeMs)} ms`
}
