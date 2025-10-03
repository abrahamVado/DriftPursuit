export interface RadarVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface RadarContactEntryPayload {
  readonly targetEntityId: string;
  readonly position?: RadarVector;
  readonly velocity?: RadarVector;
  readonly confidence?: number;
  readonly occluded?: boolean;
}

export interface RadarContactPayload {
  readonly sourceEntityId?: string;
  readonly entries?: RadarContactEntryPayload[];
}

export interface HudRadarContact {
  readonly id: string;
  readonly source: string;
  readonly occluded: boolean;
  readonly confidence: number;
  readonly lastSeenMs: number;
  readonly ageMs: number;
  readonly position?: RadarVector;
  readonly velocity?: RadarVector;
}

export interface HudRadarSnapshot {
  readonly visible: HudRadarContact[];
  readonly lastKnown: HudRadarContact[];
}

interface TrackedContact {
  readonly id: string;
  readonly source: string;
  position?: RadarVector;
  velocity?: RadarVector;
  confidence: number;
  occluded: boolean;
  lastSeenMs: number;
  updatedMs: number;
}

function makeKey(source: string, target: string): string {
  return `${source}:${target}`;
}

function cloneVector(vector?: RadarVector): RadarVector | undefined {
  if (!vector) {
    return undefined;
  }
  return { x: vector.x, y: vector.y, z: vector.z };
}

export class RadarContactTracker {
  private readonly contacts = new Map<string, TrackedContact>();

  constructor(private readonly retentionMs: number = 6000) {}

  ingest(contact: RadarContactPayload | undefined, timestampMs: number): void {
    if (!contact || !contact.entries || contact.entries.length === 0) {
      return;
    }
    const source = contact.sourceEntityId ?? "unknown";
    //1.- Normalise each entry and refresh the tracking map in-place.
    for (const entry of contact.entries) {
      if (!entry || !entry.targetEntityId) {
        continue;
      }
      const key = makeKey(source, entry.targetEntityId);
      const tracked = this.contacts.get(key);
      const occluded = entry.occluded === true;
      if (!tracked) {
        if (occluded && !entry.position) {
          //2.- Ignore occluded entries without a last known state to avoid fabricating targets.
          continue;
        }
        this.contacts.set(key, {
          id: entry.targetEntityId,
          source,
          position: cloneVector(entry.position),
          velocity: cloneVector(entry.velocity),
          confidence: entry.confidence ?? 1,
          occluded,
          lastSeenMs: timestampMs,
          updatedMs: timestampMs,
        });
        continue;
      }
      if (!occluded && entry.position) {
        //3.- Visible updates refresh the last known kinematics immediately.
        tracked.position = cloneVector(entry.position);
      }
      if (!occluded && entry.velocity) {
        tracked.velocity = cloneVector(entry.velocity);
      }
      if (!occluded) {
        tracked.lastSeenMs = timestampMs;
      }
      tracked.occluded = occluded;
      tracked.updatedMs = timestampMs;
      if (typeof entry.confidence === "number") {
        tracked.confidence = entry.confidence;
      } else if (occluded) {
        //4.- Estimate confidence decay when the server omits an explicit value.
        tracked.confidence = this.estimateConfidence(tracked, timestampMs);
      } else {
        tracked.confidence = 1;
      }
    }
    this.expire(timestampMs);
  }

  snapshot(nowMs: number): HudRadarSnapshot {
    this.expire(nowMs);
    const visible: HudRadarContact[] = [];
    const lastKnown: HudRadarContact[] = [];
    //5.- Materialise deterministic HUD datasets so widgets can render stable ordering.
    for (const tracked of this.contacts.values()) {
      const contact: HudRadarContact = {
        id: tracked.id,
        source: tracked.source,
        occluded: tracked.occluded,
        confidence: tracked.confidence,
        lastSeenMs: tracked.lastSeenMs,
        ageMs: Math.max(0, nowMs - tracked.lastSeenMs),
        position: cloneVector(tracked.position),
        velocity: cloneVector(tracked.velocity),
      };
      if (tracked.occluded) {
        lastKnown.push(contact);
      } else {
        visible.push(contact);
      }
    }
    visible.sort((a, b) => a.id.localeCompare(b.id));
    lastKnown.sort((a, b) => a.id.localeCompare(b.id));
    return { visible, lastKnown };
  }

  private estimateConfidence(tracked: TrackedContact, nowMs: number): number {
    if (this.retentionMs <= 0) {
      return 0.1;
    }
    const elapsed = nowMs - tracked.lastSeenMs;
    if (elapsed <= 0) {
      return Math.max(tracked.confidence, 0.1);
    }
    const ratio = 1 - elapsed / this.retentionMs;
    if (ratio <= 0) {
      return 0.1;
    }
    return Math.max(0.1, Math.min(1, ratio));
  }

  private expire(nowMs: number): void {
    if (this.retentionMs <= 0) {
      return;
    }
    for (const [key, tracked] of this.contacts.entries()) {
      if (nowMs - tracked.updatedMs >= this.retentionMs) {
        //6.- Drop stale contacts once they exceed the retention window to avoid ghost blips.
        this.contacts.delete(key);
      }
    }
  }
}

