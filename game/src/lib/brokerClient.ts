import { getBrokerConfig, resolveBrowserUrl } from "./brokerConfig";

export const INTENT_SCHEMA_VERSION = "0.1.0";
export const OBSERVER_SCHEMA_VERSION = "0.1.0";

export type BrokerGameEvent = {
  eventId?: string;
  metadata?: Record<string, string>;
  type?: string;
};

export type BrokerWorldDiffEnvelope = {
  type: "world_diff";
  tick: number;
  vehicles?: {
    updated?: Array<Record<string, unknown>>;
    removed?: string[];
  };
  projectiles?: {
    updated?: Array<Record<string, unknown>>;
    removed?: string[];
  };
  events?: BrokerGameEvent[];
};

export type BrokerIntentSnapshot = {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  gear: number;
  boost: boolean;
};

type WorldDiffListener = (diff: BrokerWorldDiffEnvelope) => void;

type BrokerClientOptions = {
  clientId?: string;
  reconnectDelayMs?: number;
};

type ConnectionState = "idle" | "connecting" | "open" | "closed";

class BrokerClientImpl {
  private readonly clientId: string;
  private readonly baseDelay: number;
  private socket: WebSocket | null = null;
  private listeners = new Set<WorldDiffListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs: number;
  private shouldReconnect = true;
  private state: ConnectionState = "idle";
  private intentQueue: string[] = [];
  private sequenceId = 0;

  constructor(options: BrokerClientOptions = {}) {
    //1.- Capture runtime options while falling back to predictable defaults for client id and retry cadence.
    this.clientId = options.clientId?.trim() || "pilot-local";
    this.baseDelay = Math.max(250, options.reconnectDelayMs ?? 1000);
    this.backoffMs = this.baseDelay;
    this.openSocket();
  }

  private url(): string {
    //2.- Resolve the configured broker URL, translating docker hostnames for browser contexts when required.
    const { wsUrl } = getBrokerConfig();
    return resolveBrowserUrl(wsUrl);
  }

  private openSocket() {
    //3.- Establish a fresh WebSocket connection while recording the new lifecycle state.
    this.clearTimer();
    this.state = "connecting";
    this.socket = new WebSocket(this.url());
    this.attachHandlers(this.socket);
  }

  private attachHandlers(socket: WebSocket) {
    //4.- Wire connection lifecycle callbacks that manage handshake, message routing, and reconnection.
    socket.addEventListener("open", () => {
      this.state = "open";
      this.backoffMs = this.baseDelay;
      this.sendHandshake();
      this.flushQueue();
    });

    socket.addEventListener("message", (event) => {
      this.handleMessage(event.data);
    });

    socket.addEventListener("close", () => {
      this.state = "closed";
      if (!this.shouldReconnect) {
        return;
      }
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      socket.close();
    });
  }

  private sendHandshake() {
    //5.- Identify the observer to the broker so downstream services associate the websocket with a pilot session.
    const handshake = {
      type: "observer_state",
      id: this.clientId,
      schema_version: OBSERVER_SCHEMA_VERSION,
      observer_id: this.clientId,
      role: "pilot",
    };
    this.sendRaw(JSON.stringify(handshake));
  }

  private flushQueue() {
    //6.- Drain buffered payloads now that the websocket is writable again.
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    for (const payload of this.intentQueue.splice(0)) {
      this.socket.send(payload);
    }
  }

  private scheduleReconnect() {
    //7.- Apply exponential backoff to avoid thundering herds when reconnecting after broker restarts.
    this.clearTimer();
    this.reconnectTimer = setTimeout(() => {
      this.backoffMs = Math.min(this.backoffMs * 2, 16000);
      this.openSocket();
    }, this.backoffMs);
  }

  private clearTimer() {
    //8.- Cancel any queued reconnect attempt prior to opening a fresh socket.
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private handleMessage(raw: unknown) {
    //9.- Parse inbound JSON payloads and forward recognised world diffs to subscribers.
    if (typeof raw !== "string") {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<BrokerWorldDiffEnvelope>;
      if (parsed?.type !== "world_diff" || typeof parsed.tick !== "number") {
        return;
      }
      for (const listener of this.listeners) {
        listener(parsed as BrokerWorldDiffEnvelope);
      }
    } catch {
      // Ignore malformed payloads.
    }
  }

  private sendRaw(payload: string) {
    //10.- Transmit immediately when connected or queue for delivery once the broker handshake completes.
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(payload);
      return;
    }
    this.intentQueue.push(payload);
  }

  onWorldDiff(listener: WorldDiffListener): () => void {
    //11.- Register subscribers so gameplay systems can react to authoritative state updates.
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  sendIntent(snapshot: BrokerIntentSnapshot) {
    //12.- Increment the intent sequence and forward the latest control frame to the broker.
    this.sequenceId += 1;
    const envelope = {
      type: "intent",
      id: this.clientId,
      schema_version: INTENT_SCHEMA_VERSION,
      controller_id: this.clientId,
      sequence_id: this.sequenceId,
      throttle: snapshot.throttle,
      brake: snapshot.brake,
      steer: snapshot.steer,
      handbrake: snapshot.handbrake,
      gear: snapshot.gear,
      boost: snapshot.boost,
    };
    this.sendRaw(JSON.stringify(envelope));
  }

  connectionState(): ConnectionState {
    //13.- Expose lifecycle status for diagnostics overlays or tests.
    return this.state;
  }

  close() {
    //14.- Terminate the websocket regardless of whether the handshake completed while suppressing future reconnect attempts during teardown.
    this.shouldReconnect = false;
    this.clearTimer();
    this.listeners.clear();
    const socket = this.socket;
    if (
      socket &&
      (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
    ) {
      socket.close();
    }
    this.socket = null;
    this.state = "closed";
  }
}

export type BrokerClient = {
  onWorldDiff: (listener: WorldDiffListener) => () => void;
  sendIntent: (snapshot: BrokerIntentSnapshot) => void;
  connectionState: () => ConnectionState;
  close: () => void;
};

export function createBrokerClient(options: BrokerClientOptions = {}): BrokerClient {
  //15.- Provide a lightweight facade so React hooks receive a stable API surface.
  const impl = new BrokerClientImpl(options);
  return {
    onWorldDiff: (listener) => impl.onWorldDiff(listener),
    sendIntent: (snapshot) => impl.sendIntent(snapshot),
    connectionState: () => impl.connectionState(),
    close: () => impl.close(),
  };
}
