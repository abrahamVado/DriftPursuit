import { Orientation, Vector3 } from "./../generated/types";

export interface SnapshotSample {
  tickId: number;
  keyframe: boolean;
  capturedAtMs: number;
  position: Vector3;
  orientation: Orientation;
}

export interface InterpolatedState extends SnapshotSample {
  //1.- When interpolated, keyframe is always false to indicate a blended frame.
  keyframe: boolean;
}

const MIN_BUFFER_MS = 100;
const MAX_BUFFER_MS = 150;
const DEFAULT_BUFFER_MS = 125;
const MAX_DELAY_SAMPLES = 20;
const POSITION_SNAP_THRESHOLD_METERS = 1.5;
const ORIENTATION_SNAP_THRESHOLD_DEGREES = 5;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function vectorDistance(a: Vector3, b: Vector3): number {
  const dx = (a?.x ?? 0) - (b?.x ?? 0);
  const dy = (a?.y ?? 0) - (b?.y ?? 0);
  const dz = (a?.z ?? 0) - (b?.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function orientationDeltaDegrees(a: Orientation, b: Orientation): number {
  const yaw = Math.abs((a?.yawDeg ?? 0) - (b?.yawDeg ?? 0));
  const pitch = Math.abs((a?.pitchDeg ?? 0) - (b?.pitchDeg ?? 0));
  const roll = Math.abs((a?.rollDeg ?? 0) - (b?.rollDeg ?? 0));
  return Math.max(yaw, Math.max(pitch, roll));
}

export class SnapshotInterpolator {
  private histories = new Map<string, SnapshotSample[]>();
  private delays: number[] = [];
  private bufferMs = DEFAULT_BUFFER_MS;

  enqueue(entityId: string, sample: SnapshotSample, receivedAtMs: number): void {
    if (!entityId) {
      return;
    }

    //1.- Update the rolling latency statistics so the playback buffer adapts to jitter.
    const delay = Math.max(0, receivedAtMs - sample.capturedAtMs);
    this.delays.push(delay);
    if (this.delays.length > MAX_DELAY_SAMPLES) {
      this.delays.shift();
    }
    const averageDelay =
      this.delays.reduce((acc, value) => acc + value, 0) / this.delays.length || DEFAULT_BUFFER_MS;
    const targetBuffer = clamp(averageDelay + 20, MIN_BUFFER_MS, MAX_BUFFER_MS);
    this.bufferMs = clamp(this.bufferMs * 0.7 + targetBuffer * 0.3, MIN_BUFFER_MS, MAX_BUFFER_MS);

    //2.- Insert the snapshot in capture-time order so interpolation remains monotonic.
    const history = this.histories.get(entityId) ?? [];
    let inserted = false;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (sample.capturedAtMs >= history[i].capturedAtMs) {
        history.splice(i + 1, 0, sample);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      history.unshift(sample);
    }

    //3.- Trim stale samples beyond one second to contain memory growth during long sessions.
    const cutoff = sample.capturedAtMs - 1000;
    while (history.length > 0 && history[0].capturedAtMs < cutoff) {
      history.shift();
    }

    this.histories.set(entityId, history);
  }

  sample(entityId: string, nowMs: number): InterpolatedState | undefined {
    const history = this.histories.get(entityId);
    if (!history || history.length === 0) {
      return undefined;
    }

    //1.- Determine the playback timestamp anchored behind real time by the adaptive buffer.
    const playbackTime = nowMs - this.bufferMs;
    if (history.length === 1 || playbackTime <= history[0].capturedAtMs) {
      return { ...history[0], keyframe: history[0].keyframe };
    }

    //2.- Locate the surrounding snapshots to perform linear interpolation.
    let nextIndex = history.findIndex((entry) => entry.capturedAtMs >= playbackTime);
    if (nextIndex === -1) {
      return { ...history[history.length - 1], keyframe: history[history.length - 1].keyframe };
    }
    const next = history[nextIndex];
    const prev = history[Math.max(0, nextIndex - 1)];

    const span = Math.max(1, next.capturedAtMs - prev.capturedAtMs);
    const t = clamp((playbackTime - prev.capturedAtMs) / span, 0, 1);

    const interpolated: InterpolatedState = {
      tickId: Math.round(lerp(prev.tickId, next.tickId, t)),
      keyframe: false,
      capturedAtMs: Math.round(lerp(prev.capturedAtMs, next.capturedAtMs, t)),
      position: {
        x: lerp(prev.position?.x ?? 0, next.position?.x ?? 0, t),
        y: lerp(prev.position?.y ?? 0, next.position?.y ?? 0, t),
        z: lerp(prev.position?.z ?? 0, next.position?.z ?? 0, t),
      },
      orientation: {
        yawDeg: lerp(prev.orientation?.yawDeg ?? 0, next.orientation?.yawDeg ?? 0, t),
        pitchDeg: lerp(prev.orientation?.pitchDeg ?? 0, next.orientation?.pitchDeg ?? 0, t),
        rollDeg: lerp(prev.orientation?.rollDeg ?? 0, next.orientation?.rollDeg ?? 0, t),
      },
    };

    //3.- Apply hard snapping when a keyframe deviates beyond the configured error thresholds.
    const candidate = next.keyframe ? next : prev.keyframe ? prev : undefined;
    if (candidate) {
      const positionError = vectorDistance(interpolated.position, candidate.position);
      const orientationError = orientationDeltaDegrees(interpolated.orientation, candidate.orientation);
      if (
        positionError > POSITION_SNAP_THRESHOLD_METERS ||
        orientationError > ORIENTATION_SNAP_THRESHOLD_DEGREES
      ) {
        return { ...candidate };
      }
    }

    return interpolated;
  }

  getBufferMs(): number {
    return this.bufferMs;
  }
}
