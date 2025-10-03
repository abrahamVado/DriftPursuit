export interface PerformanceSnapshot {
  samples: number;
  averageFps: number;
  minFps: number;
  maxFps: number;
}

export class PerformanceMonitor {
  private readonly capacity: number;
  private readonly timestamps: number[] = [];

  constructor(capacity = 240) {
    if (!Number.isFinite(capacity) || capacity <= 1) {
      throw new Error("capacity must be greater than one");
    }
    // //1.- Store the sliding-window capacity so heavy loads only retain recent frames.
    this.capacity = Math.floor(capacity);
  }

  record(timestampMs: number): void {
    if (!Number.isFinite(timestampMs)) {
      throw new Error("timestamp must be finite");
    }
    if (this.timestamps.length > 0 && timestampMs <= this.timestamps[this.timestamps.length - 1]) {
      throw new Error("timestamps must be strictly increasing");
    }
    // //2.- Append the timestamp while trimming the buffer to the configured capacity.
    this.timestamps.push(timestampMs);
    if (this.timestamps.length > this.capacity) {
      this.timestamps.shift();
    }
  }

  snapshot(): PerformanceSnapshot {
    if (this.timestamps.length < 2) {
      // //3.- Avoid division by zero when we do not yet have frame deltas.
      return { samples: 0, averageFps: 0, minFps: 0, maxFps: 0 };
    }

    const fpsSamples: number[] = [];
    for (let index = 1; index < this.timestamps.length; index += 1) {
      const frameDeltaMs = this.timestamps[index] - this.timestamps[index - 1];
      const frameSeconds = frameDeltaMs / 1000;
      if (frameSeconds <= 0) {
        continue;
      }
      // //4.- Convert the frame duration into an instantaneous FPS sample.
      fpsSamples.push(1 / frameSeconds);
    }

    if (fpsSamples.length === 0) {
      return { samples: 0, averageFps: 0, minFps: 0, maxFps: 0 };
    }

    let sum = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const sample of fpsSamples) {
      // //5.- Accumulate aggregates so the snapshot can expose average and extrema.
      sum += sample;
      min = Math.min(min, sample);
      max = Math.max(max, sample);
    }

    const average = sum / fpsSamples.length;
    return { samples: fpsSamples.length, averageFps: average, minFps: min, maxFps: max };
  }
}
