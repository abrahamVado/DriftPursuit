import { ClockSynchronizer, TimeSyncUpdate } from "../timeSync";

type TimeSyncEnvelope = {
  type?: string;
  server_timestamp_ms?: number;
  simulated_timestamp_ms?: number;
  recommended_offset_ms?: number;
};

export class TimeSyncController {
  private readonly clock = new ClockSynchronizer();

  handleMessage(payload: unknown, receivedAtMs = Date.now()): void {
    //1.- Accept inbound JSON payloads, guard against malformed packets, and feed the synchroniser.
    if (!payload || typeof payload !== "object") {
      return;
    }
    const envelope = payload as TimeSyncEnvelope;
    if (envelope.type !== "time_sync") {
      return;
    }

    const update: TimeSyncUpdate = {
      server_timestamp_ms: Number(envelope.server_timestamp_ms ?? 0),
      simulated_timestamp_ms: Number(envelope.simulated_timestamp_ms ?? 0),
      recommended_offset_ms: Number(envelope.recommended_offset_ms ?? 0),
    };
    this.clock.ingest(update, receivedAtMs);
  }

  currentOffset(): number {
    //1.- Surface the blended offset so rendering systems can align animations to the broker clock.
    return this.clock.currentOffset();
  }

  now(sourceMs = Date.now()): number {
    //1.- Provide a helper that projects the authoritative timeline using the synchronised offset.
    return this.clock.now(sourceMs);
  }
}
