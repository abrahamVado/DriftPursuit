import {
  WebSocketClient,
  type EntitiesEventDetail,
  type WebSocketClientOptions,
} from "@web/networking/WebSocketClient";
import type { SocketDialOptions } from "@web/networking/authenticatedSocket";
import type { Orientation, Vector3 } from "../generated/types";
import type { InterpolatedState } from "./interpolator";

export interface EntityTransform {
  entityId: string;
  tickId: number;
  capturedAtMs: number;
  keyframe: boolean;
  position: Vector3;
  orientation: Orientation;
}

export type WorldStoreSubscriber = (state: ReadonlyMap<string, EntityTransform>) => void;

interface WorldStore {
  subscribe(subscriber: WorldStoreSubscriber): () => void;
  snapshot(): ReadonlyMap<string, EntityTransform>;
  upsert(entityId: string, state: InterpolatedState): void;
  remove(entityId: string): void;
  clear(): void;
}

class EntityStore implements WorldStore {
  private readonly state = new Map<string, EntityTransform>();
  private readonly subscribers = new Set<WorldStoreSubscriber>();

  subscribe(subscriber: WorldStoreSubscriber): () => void {
    //1.- Immediately replay the latest snapshot so new observers render without waiting for the next tick.
    this.subscribers.add(subscriber);
    subscriber(this.snapshot());
    return () => {
      //2.- Remove the listener and avoid retaining closures once the component unmounts.
      this.subscribers.delete(subscriber);
    };
  }

  snapshot(): ReadonlyMap<string, EntityTransform> {
    //1.- Provide an immutable copy so callers cannot mutate the internal state map.
    return new Map(this.state);
  }

  upsert(entityId: string, state: InterpolatedState): void {
    //1.- Materialise a stable transform payload and emit only when a mutation occurs.
    const next: EntityTransform = {
      entityId,
      tickId: state.tickId,
      capturedAtMs: state.capturedAtMs,
      keyframe: state.keyframe,
      position: { ...state.position },
      orientation: { ...state.orientation },
    };
    const existing = this.state.get(entityId);
    if (
      existing &&
      existing.tickId === next.tickId &&
      existing.capturedAtMs === next.capturedAtMs &&
      existing.keyframe === next.keyframe &&
      existing.position.x === next.position.x &&
      existing.position.y === next.position.y &&
      existing.position.z === next.position.z &&
      existing.orientation.yawDeg === next.orientation.yawDeg &&
      existing.orientation.pitchDeg === next.orientation.pitchDeg &&
      existing.orientation.rollDeg === next.orientation.rollDeg
    ) {
      return;
    }
    this.state.set(entityId, next);
    this.emit();
  }

  remove(entityId: string): void {
    //1.- Drop transforms for entities that are no longer tracked so the UI unmounts stale actors.
    if (this.state.delete(entityId)) {
      this.emit();
    }
  }

  clear(): void {
    //1.- Reset the store when the transport disconnects to ensure stale data does not survive reconnects.
    if (this.state.size === 0) {
      return;
    }
    this.state.clear();
    this.emit();
  }

  private emit(): void {
    //1.- Fan out a cloned snapshot to every subscriber to keep change detection predictable.
    const snapshot = this.snapshot();
    for (const subscriber of this.subscribers) {
      subscriber(snapshot);
    }
  }
}

export interface WorldSessionOptions {
  dial?: Partial<SocketDialOptions> & { auth: SocketDialOptions["auth"] };
  updateIntervalMs?: number;
  now?: () => number;
  clientOptions?: Omit<Partial<WebSocketClientOptions>, "dial">;
}

export interface WorldSessionHandle {
  client: WebSocketClient;
  store: WorldStore;
  connect(): Promise<void>;
  disconnect(): void;
  dispose(): void;
  trackEntity(entityId: string): () => void;
}

const DEFAULT_UPDATE_INTERVAL_MS = 50;

function resolveDialOptions(overrides?: WorldSessionOptions["dial"]): SocketDialOptions {
  //1.- Pull the broker URL from the environment and allow caller overrides for tests or multi-env setups.
  const envUrl = process.env.NEXT_PUBLIC_BROKER_URL?.trim() ?? "";
  const url = overrides?.url ?? envUrl;
  if (!url) {
    throw new Error("WorldSession requires NEXT_PUBLIC_BROKER_URL or an explicit dial.url override");
  }

  const auth = overrides?.auth;
  if (!auth) {
    throw new Error("WorldSession requires authentication overrides to dial the broker");
  }
  if (!auth.subject || auth.subject.trim() === "") {
    throw new Error("WorldSession auth.subject must be provided");
  }
  if (!auth.token && !auth.secret) {
    throw new Error("WorldSession auth must include either a token or secret");
  }

  return {
    url,
    protocols: overrides?.protocols,
    auth: {
      subject: auth.subject,
      token: auth.token,
      secret: auth.secret,
      audience: auth.audience,
      ttlSeconds: auth.ttlSeconds,
    },
  };
}

export function createWorldSession(options: WorldSessionOptions): WorldSessionHandle {
  //1.- Share a single clock between the wrapper and client so interpolation samples align with render ticks.
  const sharedNow = options.now ?? options.clientOptions?.now ?? (() => Date.now());
  const dial = resolveDialOptions(options.dial);
  const clientOptions: WebSocketClientOptions = {
    ...options.clientOptions,
    dial,
    now: sharedNow,
  } as WebSocketClientOptions;
  const client = new WebSocketClient(clientOptions);
  const store = new EntityStore();
  const trackedEntities = new Set<string>();
  const manualTracked = new Set<string>();
  const autoTracked = new Set<string>();
  const updateInterval = options.updateIntervalMs ?? DEFAULT_UPDATE_INTERVAL_MS;
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const statusListener = (event: Event): void => {
    //1.- Reset local caches when the transport transitions back to disconnected.
    const detail = (event as CustomEvent<string>).detail;
    if (detail === "disconnected") {
      store.clear();
    }
  };
  client.addEventListener("status", statusListener as EventListener);

  const rosterListener = (event: Event): void => {
    //1.- Maintain automatic entity tracking so every observed craft appears inside the shared world store.
    const detail = (event as CustomEvent<EntitiesEventDetail>).detail;
    for (const entityId of detail.added ?? []) {
      autoTrack(entityId);
    }
    for (const entityId of detail.removed ?? []) {
      autoUntrack(entityId);
    }
  };
  client.addEventListener("entities", rosterListener as EventListener);

  function tick(): void {
    //1.- Sample the interpolated state for every tracked entity using the shared clock.
    if (disposed) {
      return;
    }
    const nowMs = sharedNow();
    const removals: string[] = [];
    for (const entityId of trackedEntities) {
      const state = client.getEntityState(entityId, nowMs);
      if (state) {
        store.upsert(entityId, state);
      } else {
        store.remove(entityId);
        if (!manualTracked.has(entityId) && !client.hasKnownEntity(entityId)) {
          removals.push(entityId);
        }
      }
    }
    if (removals.length > 0) {
      for (const entityId of removals) {
        trackedEntities.delete(entityId);
        autoTracked.delete(entityId);
      }
      stopTimer();
    }
  }

  function ensureTimer(): void {
    //1.- Lazily initialise the polling loop so idle sessions do not schedule unnecessary work.
    if (!timer && trackedEntities.size > 0) {
      timer = setInterval(tick, updateInterval);
    }
  }

  function stopTimer(): void {
    //1.- Tear down the interval when no observers remain to mirror React unmount semantics.
    if (timer && trackedEntities.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  function connect(): Promise<void> {
    //1.- Delegate connection attempts to the underlying client which already performs debouncing.
    return client.connect();
  }

  function disconnect(): void {
    //1.- Allow consumers to forcefully close the transport without disposing of the session instance.
    client.disconnect();
    trackedEntities.clear();
    manualTracked.clear();
    autoTracked.clear();
    store.clear();
    stopTimer();
  }

  function dispose(): void {
    //1.- Guard against double disposal triggered by hot reload cycles in development.
    if (disposed) {
      return;
    }
    disposed = true;
    client.removeEventListener("status", statusListener as EventListener);
    client.removeEventListener("entities", rosterListener as EventListener);
    trackedEntities.clear();
    manualTracked.clear();
    autoTracked.clear();
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
    client.disconnect();
    store.clear();
  }

  function trackEntity(entityId: string): () => void {
    //1.- Begin sampling an entity once a UI consumer expresses interest in its transform.
    if (!entityId) {
      return () => undefined;
    }
    manualTracked.add(entityId);
    trackedEntities.add(entityId);
    autoTracked.delete(entityId);
    ensureTimer();
    tick();
    return () => {
      //2.- Stop sampling the entity once the consumer unsubscribes to avoid leaking memory.
      manualTracked.delete(entityId);
      if (!autoTracked.has(entityId)) {
        trackedEntities.delete(entityId);
        store.remove(entityId);
      }
      stopTimer();
    };
  }

  function autoTrack(entityId: string): void {
    //1.- Track broker-supplied entities so every pilot shares the same world snapshot automatically.
    if (!entityId || trackedEntities.has(entityId)) {
      return;
    }
    trackedEntities.add(entityId);
    autoTracked.add(entityId);
    ensureTimer();
    tick();
  }

  function autoUntrack(entityId: string): void {
    //1.- Drop automatically tracked entities that the broker flagged as inactive.
    if (!entityId || manualTracked.has(entityId) || !trackedEntities.has(entityId)) {
      return;
    }
    trackedEntities.delete(entityId);
    autoTracked.delete(entityId);
    store.remove(entityId);
    stopTimer();
  }

  return {
    client,
    store,
    connect,
    disconnect,
    dispose,
    trackEntity,
  };
}
