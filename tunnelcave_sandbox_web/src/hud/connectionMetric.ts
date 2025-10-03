import type { ConnectionStatus } from '../networking/WebSocketClient'
import { HudMetric } from './hudMetric'

export interface ConnectionMetricOptions {
  //1.- WebSocketClient exposes connection lifecycle transitions for the metric.
  client: EventTarget & { getConnectionStatus(): ConnectionStatus }
}

export class ConnectionMetric {
  private readonly metric: HudMetric
  private readonly onStatusChange: (event: Event) => void
  private readonly client: ConnectionMetricOptions['client']

  constructor(root: HTMLElement, options: ConnectionMetricOptions) {
    this.client = options.client
    //1.- Seed the metric with the client's current status to avoid an empty render.
    this.metric = new HudMetric(root, {
      label: 'Connection',
      description: 'Server connection status',
      initialValue: formatStatus(this.client.getConnectionStatus()),
    })
    this.onStatusChange = (event: Event) => {
      const detail = (event as CustomEvent<ConnectionStatus>).detail
      const status = detail ?? this.client.getConnectionStatus()
      this.metric.update(formatStatus(status))
    }
    this.client.addEventListener('status', this.onStatusChange as EventListener)
  }

  dispose(): void {
    //1.- Remove the event listener so reconnect cycles do not leak DOM references.
    this.client.removeEventListener('status', this.onStatusChange as EventListener)
  }
}

function formatStatus(status: ConnectionStatus): string {
  //1.- Present human readable copy for each status case.
  switch (status) {
    case 'connected':
      return 'Online'
    case 'connecting':
      return 'Syncing'
    default:
      return 'Offline'
  }
}
