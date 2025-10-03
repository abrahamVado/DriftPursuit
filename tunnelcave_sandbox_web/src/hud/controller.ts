import type { EventStreamClient } from '../../../typescript-client/src/eventStream'
import type { ConnectionStatus } from '../networking/WebSocketClient'
import { ConnectionMetric } from './connectionMetric'
import { CorrectionMetric } from './correctionMetric'
import { PlaybackMetric } from './playbackMetric'
import { ScoreboardAggregator } from './scoreboardAggregator'
import { ScoreboardOverlay } from './scoreboardOverlay'

export interface HudControllerOptions {
  //1.- DOM node that will host the metric widgets and overlays.
  root: HTMLElement
  //2.- Connected WebSocket client providing interpolation telemetry.
  client: EventTarget & {
    getConnectionStatus(): ConnectionStatus
    getPlaybackBufferMs(): number
  }
  //3.- Optional event stream client for scoreboard updates.
  eventStream?: EventStreamClient
}

export class HudController {
  private readonly connectionMetric: ConnectionMetric
  private readonly playbackMetric: PlaybackMetric
  private readonly correctionMetric: CorrectionMetric
  private readonly scoreboardAggregator: ScoreboardAggregator
  private readonly scoreboardOverlay: ScoreboardOverlay
  private unbindStream?: () => void

  constructor(options: HudControllerOptions) {
    const { root, client, eventStream } = options
    //1.- Instantiate modular metrics so each concern remains individually testable.
    this.connectionMetric = new ConnectionMetric(root, { client })
    this.playbackMetric = new PlaybackMetric(root, { client })
    this.correctionMetric = new CorrectionMetric(root, { client })
    this.scoreboardAggregator = new ScoreboardAggregator()
    this.scoreboardOverlay = new ScoreboardOverlay(root, this.scoreboardAggregator)
    if (eventStream) {
      this.unbindStream = this.scoreboardAggregator.bindStream(eventStream)
    }
  }

  aggregator(): ScoreboardAggregator {
    //1.- Expose the scoreboard aggregator for manual event injection in tests.
    return this.scoreboardAggregator
  }

  dispose(): void {
    //1.- Tear down metrics and stream bindings so hot reloads do not leak timers.
    if (this.unbindStream) {
      this.unbindStream()
    }
    this.scoreboardOverlay.dispose()
    this.playbackMetric.dispose()
    this.correctionMetric.dispose()
    this.connectionMetric.dispose()
  }
}
