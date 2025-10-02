export interface TimeSyncUpdate {
  server_timestamp_ms: number;
  simulated_timestamp_ms: number;
  recommended_offset_ms: number;
}

export class ClockSynchronizer {
  private offsetMs = 0;
  private lastUpdateMs = 0;
  private readonly toleranceMs: number;
  private readonly smoothingFactor: number;

  constructor(toleranceMs = 50, smoothingFactor = 0.2) {
    this.toleranceMs = Math.max(0, toleranceMs);
    this.smoothingFactor = Math.min(1, Math.max(0, smoothingFactor));
  }

  //1.- Blend the recommended offset into the local clock while respecting the configured tolerance.
  ingest(update: TimeSyncUpdate | null | undefined, receivedAtMs = Date.now()): void {
    if (!update) {
      return;
    }
    const guidance = Number(update.recommended_offset_ms ?? 0);
    if (!Number.isFinite(guidance)) {
      return;
    }

    const delta = guidance - this.offsetMs;
    const absDelta = Math.abs(delta);
    if (absDelta > this.toleranceMs) {
      this.offsetMs += Math.sign(delta) * this.toleranceMs;
    } else {
      this.offsetMs += delta * this.smoothingFactor;
    }
    this.lastUpdateMs = receivedAtMs;
  }

  //2.- Expose the currently estimated offset for diagnostics or secondary smoothing layers.
  currentOffset(): number {
    return this.offsetMs;
  }

  //3.- Project the synchronised server time using the blended offset.
  now(sourceMs = Date.now()): number {
    return sourceMs + this.offsetMs;
  }

  //4.- Report when the last correction was applied so callers can refresh on stale data.
  lastUpdateTimestamp(): number {
    return this.lastUpdateMs;
  }
}
