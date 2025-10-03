import { BinaryReader } from "@bufbuild/protobuf/wire";
import type { Orientation, Vector3 } from "../../../typescript-client/src/generated/types";
import { openAuthenticatedSocket, type SocketDialOptions } from "./authenticatedSocket";
import { SnapshotInterpolator, type InterpolatedState, type SnapshotSample } from "./interpolator";
import { TimeSyncController } from "./timeSync";

type Logger = {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

const DEFAULT_LOGGER: Logger = {
  //1.- Route debug output through console.debug so the browser devtools grouping is preserved.
  debug: (...args: unknown[]) => console.debug(...args),
  //2.- Emit informational updates such as connection lifecycle changes to the console.
  info: (...args: unknown[]) => console.info(...args),
  //3.- Warnings highlight correction events that exceeded reconciliation thresholds.
  warn: (...args: unknown[]) => console.warn(...args),
  //4.- Errors funnel into console.error to surface unexpected transport failures.
  error: (...args: unknown[]) => console.error(...args),
};

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface WebSocketClientOptions {
  dial: SocketDialOptions;
  reconciliationDelayMs?: number;
  maxBufferedSnapshots?: number;
  logger?: Partial<Logger>;
  openSocket?: (options: SocketDialOptions) => Promise<WebSocket>;
  now?: () => number;
}

export interface CorrectionEventDetail {
  entityId: string;
  positionError: number;
  orientationError: number;
  tickId: number;
}

interface DecodedEntitySnapshot {
  entityId: string;
  tickId: number;
  capturedAtMs: number;
  keyframe: boolean;
  position?: Vector3;
  orientation?: Orientation;
}

interface DecodedWorldSnapshot {
  tickId: number;
  capturedAtMs: number;
  keyframe: boolean;
  entities: DecodedEntitySnapshot[];
}

interface PendingSnapshot {
  snapshot: DecodedWorldSnapshot;
  receivedAtMs: number;
}

interface ForcedCorrection {
  state: InterpolatedState;
  expiresAtMs: number;
}

const POSITION_CORRECTION_THRESHOLD_METERS = 2;
const ORIENTATION_CORRECTION_THRESHOLD_DEGREES = 15;
const DEFAULT_RECONCILIATION_DELAY_MS = 150;
const DEFAULT_MAX_BUFFERED_SNAPSHOTS = 32;

function mergeLogger(overrides?: Partial<Logger>): Logger {
  //1.- Merge the optional overrides with the default console logger so callers can inject spies in tests.
  return {
    debug: overrides?.debug ?? DEFAULT_LOGGER.debug,
    info: overrides?.info ?? DEFAULT_LOGGER.info,
    warn: overrides?.warn ?? DEFAULT_LOGGER.warn,
    error: overrides?.error ?? DEFAULT_LOGGER.error,
  };
}

function longToNumber(value: { toString(): string }): number {
  //1.- Convert 64-bit integers produced by the protobuf reader into JavaScript numbers safely.
  return Number(value.toString());
}

function decodeVector3(reader: BinaryReader, length: number): Vector3 {
  //1.- Traverse the packed Vector3 message and map numeric components into the return structure.
  const end = reader.pos + length;
  const vector: Vector3 = { x: 0, y: 0, z: 0 };
  while (reader.pos < end) {
    const tag = reader.uint32();
    switch (tag >>> 3) {
      case 1:
        vector.x = reader.double();
        continue;
      case 2:
        vector.y = reader.double();
        continue;
      case 3:
        vector.z = reader.double();
        continue;
    }
    if ((tag & 7) === 4 || tag === 0) {
      break;
    }
    reader.skip(tag & 7);
  }
  return vector;
}

function decodeOrientation(reader: BinaryReader, length: number): Orientation {
  //1.- Decode the Orientation protobuf payload emitted by the broker snapshots.
  const end = reader.pos + length;
  const orientation: Orientation = { yawDeg: 0, pitchDeg: 0, rollDeg: 0 };
  while (reader.pos < end) {
    const tag = reader.uint32();
    switch (tag >>> 3) {
      case 1:
        orientation.yawDeg = reader.double();
        continue;
      case 2:
        orientation.pitchDeg = reader.double();
        continue;
      case 3:
        orientation.rollDeg = reader.double();
        continue;
    }
    if ((tag & 7) === 4 || tag === 0) {
      break;
    }
    reader.skip(tag & 7);
  }
  return orientation;
}

function decodeEntitySnapshot(reader: BinaryReader, length: number): DecodedEntitySnapshot {
  //1.- Walk the embedded EntitySnapshot message extracting the minimal state used by the renderer.
  const end = reader.pos + length;
  const entity: DecodedEntitySnapshot = {
    entityId: "",
    tickId: 0,
    capturedAtMs: 0,
    keyframe: false,
  };
  while (reader.pos < end) {
    const tag = reader.uint32();
    switch (tag >>> 3) {
      case 2:
        entity.entityId = reader.string();
        continue;
      case 4:
        entity.position = decodeVector3(reader, reader.uint32());
        continue;
      case 6:
        entity.orientation = decodeOrientation(reader, reader.uint32());
        continue;
      case 10:
        entity.capturedAtMs = longToNumber(reader.int64());
        continue;
      case 11:
        entity.tickId = longToNumber(reader.uint64());
        continue;
      case 12:
        entity.keyframe = reader.bool();
        continue;
    }
    if ((tag & 7) === 4 || tag === 0) {
      break;
    }
    reader.skip(tag & 7);
  }
  return entity;
}

export function decodeWorldSnapshot(payload: ArrayBuffer | Uint8Array): DecodedWorldSnapshot {
  //1.- Normalise the input buffer into a Uint8Array so the protobuf reader can traverse it.
  const buffer = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const reader = new BinaryReader(buffer);
  const snapshot: DecodedWorldSnapshot = {
    tickId: 0,
    capturedAtMs: 0,
    keyframe: false,
    entities: [],
  };
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    switch (tag >>> 3) {
      case 2:
        snapshot.capturedAtMs = longToNumber(reader.int64());
        continue;
      case 3:
        snapshot.entities.push(decodeEntitySnapshot(reader, reader.uint32()));
        continue;
      case 6:
        snapshot.tickId = longToNumber(reader.uint64());
        continue;
      case 7:
        snapshot.keyframe = reader.bool();
        continue;
    }
    if ((tag & 7) === 4 || tag === 0) {
      break;
    }
    reader.skip(tag & 7);
  }
  return snapshot;
}

function vectorDistance(a?: Vector3, b?: Vector3): number {
  //1.- Compute Euclidean distance in metres between two positions using defensive defaults.
  const dx = (a?.x ?? 0) - (b?.x ?? 0);
  const dy = (a?.y ?? 0) - (b?.y ?? 0);
  const dz = (a?.z ?? 0) - (b?.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function orientationDeltaDegrees(a?: Orientation, b?: Orientation): number {
  //1.- Measure the maximum angular delta across yaw/pitch/roll axes to evaluate correction thresholds.
  const yaw = Math.abs((a?.yawDeg ?? 0) - (b?.yawDeg ?? 0));
  const pitch = Math.abs((a?.pitchDeg ?? 0) - (b?.pitchDeg ?? 0));
  const roll = Math.abs((a?.rollDeg ?? 0) - (b?.rollDeg ?? 0));
  return Math.max(yaw, Math.max(pitch, roll));
}

function normaliseWorldSnapshotJson(raw: unknown): DecodedWorldSnapshot | undefined {
  //1.- Validate that the JSON payload resembles the broker snapshot envelope before coercing values.
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const payload = raw as Record<string, unknown>;
  if (!Array.isArray(payload.entities)) {
    return undefined;
  }
  const snapshot: DecodedWorldSnapshot = {
    tickId: Number(payload.tickId ?? 0),
    capturedAtMs: Number(payload.capturedAtMs ?? 0),
    keyframe: Boolean(payload.keyframe),
    entities: [],
  };
  for (const candidate of payload.entities as unknown[]) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const entityPayload = candidate as Record<string, unknown>;
    const entity: DecodedEntitySnapshot = {
      entityId: String(entityPayload.entityId ?? ""),
      tickId: Number(entityPayload.tickId ?? 0),
      capturedAtMs: Number(entityPayload.capturedAtMs ?? snapshot.capturedAtMs ?? 0),
      keyframe: Boolean(entityPayload.keyframe ?? snapshot.keyframe),
      position: entityPayload.position as Vector3 | undefined,
      orientation: entityPayload.orientation as Orientation | undefined,
    };
    if (entity.entityId !== "") {
      snapshot.entities.push(entity);
    }
  }
  return snapshot;
}

export class WebSocketClient extends EventTarget {
  private readonly options: Required<WebSocketClientOptions>;
  private socket?: WebSocket;
  private status: ConnectionStatus = "disconnected";
  private readonly logger: Logger;
  private readonly interpolator = new SnapshotInterpolator();
  private readonly timeSync = new TimeSyncController();
  private readonly pendingSnapshots: PendingSnapshot[] = [];
  private readonly latestStates = new Map<string, InterpolatedState>();
  private readonly forcedCorrections = new Map<string, ForcedCorrection>();

  constructor(options: WebSocketClientOptions) {
    super();
    //1.- Fold defaults into the provided configuration to keep the constructor lightweight for callers.
    const nowFn = options.now ?? (() => Date.now());
    this.options = {
      reconciliationDelayMs: options.reconciliationDelayMs ?? DEFAULT_RECONCILIATION_DELAY_MS,
      maxBufferedSnapshots: options.maxBufferedSnapshots ?? DEFAULT_MAX_BUFFERED_SNAPSHOTS,
      logger: options.logger ?? {},
      openSocket: options.openSocket ?? openAuthenticatedSocket,
      now: nowFn,
      dial: options.dial,
    };
    this.logger = mergeLogger(options.logger);
  }

  async connect(): Promise<void> {
    //1.- Skip redundant connection attempts while an existing session is active or in-flight.
    if (this.status !== "disconnected") {
      return;
    }
    this.setStatus("connecting");
    try {
      const socket = await this.options.openSocket(this.options.dial);
      socket.binaryType = "arraybuffer";
      this.attachSocket(socket);
    } catch (error) {
      this.logger.error("websocket connect failed", error);
      this.setStatus("disconnected");
      throw error;
    }
  }

  disconnect(code?: number, reason?: string): void {
    //1.- Close the active socket (if any) and reset buffering state to prepare for future reconnects.
    if (this.socket && this.status !== "disconnected") {
      try {
        this.socket.close(code, reason);
      } catch (error) {
        this.logger.warn("websocket close raised", error);
      }
    }
    this.socket = undefined;
    this.pendingSnapshots.length = 0;
    this.latestStates.clear();
    this.forcedCorrections.clear();
    this.setStatus("disconnected");
  }

  getConnectionStatus(): ConnectionStatus {
    //1.- Expose the latest connection lifecycle state for UI overlays.
    return this.status;
  }

  getEntityState(entityId: string, nowMs = this.authoritativeNow()): InterpolatedState | undefined {
    //1.- Advance the snapshot buffer using the current authoritative clock before sampling the interpolator.
    this.drainSnapshotBuffer(nowMs);
    const correction = this.forcedCorrections.get(entityId);
    if (correction) {
      if (nowMs <= correction.expiresAtMs) {
        this.latestStates.set(entityId, correction.state);
        return correction.state;
      }
      this.forcedCorrections.delete(entityId);
    }
    const state = this.interpolator.sample(entityId, nowMs);
    if (state) {
      this.latestStates.set(entityId, state);
    }
    return state;
  }

  getPlaybackBufferMs(): number {
    //1.- Surface the adaptive interpolation delay to aid in HUD debugging widgets.
    return this.interpolator.getBufferMs();
  }

  private attachSocket(socket: WebSocket): void {
    //1.- Register lifecycle handlers so connection state transitions trigger logs and UI events.
    this.socket = socket;
    socket.onopen = () => {
      this.logger.info("websocket connected");
      this.setStatus("connected");
    };
    socket.onclose = (event) => {
      this.logger.info("websocket closed", event);
      this.setStatus("disconnected");
    };
    socket.onerror = (event) => {
      this.logger.error("websocket error", event);
    };
    socket.onmessage = (event) => {
      this.handleIncomingMessage(event.data);
    };
  }

  private setStatus(status: ConnectionStatus): void {
    //1.- Update the cached status, broadcast to listeners, and emit console diagnostics.
    if (this.status === status) {
      return;
    }
    this.status = status;
    this.dispatchEvent(new CustomEvent<ConnectionStatus>("status", { detail: status }));
  }

  private authoritativeNow(): number {
    //1.- Project the server timeline using the synchronised clock helper and injected time source.
    return this.timeSync.now(this.options.now());
  }

  private drainSnapshotBuffer(nowMs = this.authoritativeNow()): void {
    //1.- Pop buffered snapshots whose capture time falls behind the reconciliation horizon.
    const releaseBefore = nowMs - this.options.reconciliationDelayMs;
    let drained = false;
    while (this.pendingSnapshots.length > 0) {
      const next = this.pendingSnapshots[0];
      if (next.snapshot.capturedAtMs > releaseBefore) {
        break;
      }
      this.pendingSnapshots.shift();
      this.ingestSnapshot(next.snapshot, next.receivedAtMs);
      drained = true;
    }
    if (drained) {
      this.logger.debug("snapshot buffer drained", {
        buffered: this.pendingSnapshots.length,
        releaseBefore,
      });
    }
  }

  private ingestSnapshot(snapshot: DecodedWorldSnapshot, receivedAtMs: number): void {
    //1.- Enqueue each entity sample into the interpolator so downstream systems can blend states.
    for (const entity of snapshot.entities) {
      if (!entity.entityId) {
        continue;
      }
      const sample: SnapshotSample = {
        tickId: entity.tickId || snapshot.tickId,
        keyframe: entity.keyframe || snapshot.keyframe,
        capturedAtMs: entity.capturedAtMs || snapshot.capturedAtMs,
        position: entity.position ?? { x: 0, y: 0, z: 0 },
        orientation: entity.orientation ?? { yawDeg: 0, pitchDeg: 0, rollDeg: 0 },
      };
      this.interpolator.enqueue(entity.entityId, sample, receivedAtMs);
      if (sample.keyframe) {
        this.evaluateCorrection(entity.entityId, sample, receivedAtMs);
      }
    }
  }

  private evaluateCorrection(entityId: string, sample: SnapshotSample, receivedAtMs: number): void {
    //1.- Compare the authoritative keyframe with the latest predicted state to decide if a correction is required.
    const predicted = this.latestStates.get(entityId);
    if (!predicted) {
      return;
    }
    const positionError = vectorDistance(sample.position, predicted.position);
    const orientationError = orientationDeltaDegrees(sample.orientation, predicted.orientation);
    if (
      positionError <= POSITION_CORRECTION_THRESHOLD_METERS &&
      orientationError <= ORIENTATION_CORRECTION_THRESHOLD_DEGREES
    ) {
      return;
    }
    const enforced: InterpolatedState = {
      tickId: sample.tickId,
      keyframe: true,
      capturedAtMs: sample.capturedAtMs,
      position: sample.position,
      orientation: sample.orientation,
    };
    this.forcedCorrections.set(entityId, {
      state: enforced,
      expiresAtMs: sample.capturedAtMs + this.options.reconciliationDelayMs,
    });
    this.logger.warn("applying snapshot correction", {
      entityId,
      positionError,
      orientationError,
      tickId: sample.tickId,
    });
    this.dispatchEvent(
      new CustomEvent<CorrectionEventDetail>("correction", {
        detail: { entityId, positionError, orientationError, tickId: sample.tickId },
      }),
    );
  }

  private handleIncomingMessage(data: unknown): void {
    //1.- Branch based on payload type to support both JSON (text frames) and binary snapshots.
    if (typeof data === "string") {
      this.handleJsonMessage(data);
      return;
    }
    if (data instanceof ArrayBuffer) {
      this.handleBinarySnapshot(data);
      return;
    }
    if (ArrayBuffer.isView(data)) {
      const view = data as ArrayBufferView;
      const copy = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      this.handleBinarySnapshot(copy);
      return;
    }
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      data.arrayBuffer().then((buffer) => this.handleBinarySnapshot(buffer)).catch((error) => {
        this.logger.error("failed to read snapshot blob", error);
      });
      return;
    }
    this.logger.debug("unknown websocket payload", data);
  }

  private handleJsonMessage(raw: string): void {
    //1.- Parse the JSON envelope and route time-sync or snapshot messages accordingly.
    try {
      const payload = JSON.parse(raw);
      if (payload?.type === "time_sync") {
        this.timeSync.handleMessage(payload, this.options.now());
        return;
      }
      if (payload?.type === "world_snapshot") {
        const snapshot = normaliseWorldSnapshotJson(payload);
        if (snapshot) {
          this.queueSnapshot(snapshot);
        }
        return;
      }
      this.logger.debug("unhandled websocket message", payload);
    } catch (error) {
      this.logger.debug("invalid json payload", error);
    }
  }

  private handleBinarySnapshot(buffer: ArrayBuffer | Uint8Array): void {
    //1.- Decode protobuf world snapshots and enqueue them for buffered processing.
    try {
      const snapshot = decodeWorldSnapshot(buffer);
      this.queueSnapshot(snapshot);
    } catch (error) {
      this.logger.error("failed to decode binary snapshot", error);
    }
  }

  private queueSnapshot(snapshot: DecodedWorldSnapshot): void {
    //1.- Maintain a bounded buffer sorted by capture time to avoid memory growth during packet loss.
    const entry: PendingSnapshot = {
      snapshot,
      receivedAtMs: this.options.now(),
    };
    this.pendingSnapshots.push(entry);
    this.pendingSnapshots.sort((a, b) => a.snapshot.capturedAtMs - b.snapshot.capturedAtMs);
    if (this.pendingSnapshots.length > this.options.maxBufferedSnapshots) {
      this.pendingSnapshots.shift();
      this.logger.warn("dropped oldest snapshot due to buffer limit");
    }
    this.drainSnapshotBuffer();
  }
}

