import { BinaryWriter } from "@bufbuild/protobuf/wire";
import { describe, expect, it, vi } from "vitest";

import type { Orientation, Vector3 } from "@client/generated/types";
import type { SocketDialOptions } from "./authenticatedSocket";
import {
  WebSocketClient,
  decodeWorldSnapshot,
  type CorrectionEventDetail,
  type EntitiesEventDetail,
} from "./WebSocketClient";

function ensureCustomEvent(): void {
  //1.- Provide a lightweight CustomEvent polyfill when the environment omits the detail accessor.
  try {
    if (typeof globalThis.CustomEvent === "function") {
      const probe = new CustomEvent("probe", { detail: { ok: true } });
      if ((probe as CustomEvent<{ ok: boolean }>).detail?.ok) {
        return;
      }
    }
  } catch {
    //1.- Swallow errors so the fallback path runs when CustomEvent construction fails.
  }
  class NodeCustomEvent<T> extends Event {
    constructor(type: string, init?: CustomEventInit<T>) {
      super(type, init);
      this.detail = init?.detail as T;
    }

    detail: T;
  }
  //2.- eslint-disable-next-line to satisfy linting when assigning globals in tests.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  globalThis.CustomEvent = NodeCustomEvent;
}

ensureCustomEvent();

interface FakeMessageEvent<T> {
  data: T;
}

class FakeWebSocket {
  onopen: ((event: FakeMessageEvent<void>) => void) | null = null;
  onclose: ((event: FakeMessageEvent<void>) => void) | null = null;
  onerror: ((event: FakeMessageEvent<unknown>) => void) | null = null;
  onmessage: ((event: FakeMessageEvent<unknown>) => void) | null = null;
  binaryType = "blob";

  constructor(private readonly triggerOpenImmediately = true) {
    //1.- Simulate asynchronous connection establishment after construction.
    if (this.triggerOpenImmediately) {
      queueMicrotask(() => this.onopen?.({ data: undefined }));
    }
  }

  close(): void {
    this.onclose?.({ data: undefined });
  }

  simulateMessage(data: unknown): void {
    this.onmessage?.({ data });
  }

  simulateError(error: unknown): void {
    this.onerror?.({ data: error });
  }
}

function makeDeterministicRandom(seed: number): () => number {
  //1.- Provide a reproducible pseudo-random generator so packet loss simulation stays deterministic.
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function encodeVector3(vector: Vector3, fieldNumber: number, writer: BinaryWriter): void {
  //1.- Marshal a Vector3 message using the same structure as the protobuf encoder.
  const nested = writer.uint32((fieldNumber << 3) | 2).fork();
  nested.uint32(9).double(vector.x);
  nested.uint32(17).double(vector.y);
  nested.uint32(25).double(vector.z);
  nested.join();
}

function encodeOrientation(orientation: Orientation, fieldNumber: number, writer: BinaryWriter): void {
  //1.- Encode the Orientation wrapper so the snapshot decoder can be exercised with real payloads.
  const nested = writer.uint32((fieldNumber << 3) | 2).fork();
  nested.uint32(9).double(orientation.yawDeg);
  nested.uint32(17).double(orientation.pitchDeg);
  nested.uint32(25).double(orientation.rollDeg);
  nested.join();
}

function encodeEntitySnapshot(options: {
  entityId: string;
  tickId: number;
  capturedAtMs: number;
  keyframe?: boolean;
  position: Vector3;
  orientation: Orientation;
  active?: boolean;
}): Uint8Array {
  //1.- Build a minimal EntitySnapshot message with deterministic ordering for test assertions.
  const writer = new BinaryWriter();
  writer.uint32(18).string(options.entityId);
  encodeVector3(options.position, 4, writer);
  encodeOrientation(options.orientation, 6, writer);
  writer.uint32(80).int64(options.capturedAtMs);
  writer.uint32(88).uint64(options.tickId);
  if (options.keyframe) {
    writer.uint32(96).bool(true);
  }
  if (options.active !== undefined) {
    writer.uint32(64).bool(options.active);
  }
  return writer.finish();
}

function encodeWorldSnapshot(options: {
  tickId: number;
  capturedAtMs: number;
  keyframe?: boolean;
  entities: ReturnType<typeof encodeEntitySnapshot>[];
}): Uint8Array {
  //1.- Aggregate entity payloads into a WorldSnapshot to exercise binary snapshot handling.
  const writer = new BinaryWriter();
  writer.uint32(16).int64(options.capturedAtMs);
  for (const entity of options.entities) {
    writer.uint32(26).bytes(entity);
  }
  writer.uint32(48).uint64(options.tickId);
  if (options.keyframe) {
    writer.uint32(56).bool(true);
  }
  return writer.finish();
}

function buildClient({
  socket,
  now,
  logger,
  reconciliationDelayMs,
}: {
  socket: FakeWebSocket;
  now: () => number;
  logger?: { warn?: (...args: unknown[]) => void; debug?: (...args: unknown[]) => void; info?: (...args: unknown[]) => void };
  reconciliationDelayMs?: number;
}): WebSocketClient {
  //1.- Provide a helper to construct the client with deterministic dependencies for each test case.
  const dial: SocketDialOptions = {
    url: "wss://example.test",
    auth: { subject: "player" },
  };
  const openSocket = vi.fn().mockResolvedValue(socket as unknown as WebSocket);
  return new WebSocketClient({
    dial,
    now,
    openSocket,
    logger,
    reconciliationDelayMs,
  });
}

describe("decodeWorldSnapshot", () => {
  it("decodes a binary snapshot emitted by the broker", () => {
    const entity = encodeEntitySnapshot({
      entityId: "alpha",
      tickId: 77,
      capturedAtMs: 1_000,
      keyframe: true,
      position: { x: 10, y: 5, z: -3 },
      orientation: { yawDeg: 90, pitchDeg: 0, rollDeg: 0 },
    });
    const world = encodeWorldSnapshot({
      tickId: 77,
      capturedAtMs: 1_000,
      keyframe: true,
      entities: [entity],
    });

    const decoded = decodeWorldSnapshot(world);

    expect(decoded.tickId).toBe(77);
    expect(decoded.keyframe).toBe(true);
    expect(decoded.entities).toHaveLength(1);
    expect(decoded.entities[0]).toMatchObject({
      entityId: "alpha",
      tickId: 77,
      keyframe: true,
      position: { x: 10, y: 5, z: -3 },
    });
  });
});

describe("WebSocketClient", () => {
  it("buffers binary snapshots and surfaces interpolated states", async () => {
    let currentTime = 0;
    const socket = new FakeWebSocket();
    const client = buildClient({ socket, now: () => currentTime });

    await client.connect();

    const entity = encodeEntitySnapshot({
      entityId: "alpha",
      tickId: 1,
      capturedAtMs: 100,
      position: { x: 0, y: 0, z: 0 },
      orientation: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 },
    });
    const world = encodeWorldSnapshot({
      tickId: 1,
      capturedAtMs: 100,
      entities: [entity],
    });

    socket.simulateMessage(world);
    currentTime = 300;

    const state = client.getEntityState("alpha", 300);
    expect(state).toBeDefined();
    expect(state?.tickId).toBe(1);
  });

  it("applies keyframe corrections when thresholds are exceeded", async () => {
    let now = 0;
    const warn = vi.fn();
    const socket = new FakeWebSocket();
    const client = buildClient({
      socket,
      now: () => now,
      logger: { warn },
      reconciliationDelayMs: 200,
    });

    await client.connect();

    socket.simulateMessage(
      JSON.stringify({
        type: "world_snapshot",
        tickId: 1,
        capturedAtMs: 100,
        keyframe: false,
        entities: [
          {
            entityId: "alpha",
            tickId: 1,
            capturedAtMs: 100,
            position: { x: 0, y: 0, z: 0 },
            orientation: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 },
          },
        ],
      }),
    );

    now = 500;
    const predicted = client.getEntityState("alpha", now);
    expect(predicted).toBeDefined();

    const future = encodeEntitySnapshot({
      entityId: "alpha",
      tickId: 2,
      capturedAtMs: 200,
      keyframe: true,
      position: { x: 10, y: 0, z: 0 },
      orientation: { yawDeg: 45, pitchDeg: 0, rollDeg: 0 },
    });

    const correctionEvents: CorrectionEventDetail[] = [];
    client.addEventListener("correction", (event) => {
      correctionEvents.push((event as CustomEvent<CorrectionEventDetail>).detail);
    });

    const world = encodeWorldSnapshot({
      tickId: 2,
      capturedAtMs: 200,
      keyframe: true,
      entities: [future],
    });
    socket.simulateMessage(world);
    const corrected = client.getEntityState("alpha", 200);

    expect(corrected?.keyframe).toBe(true);
    expect(warn).toHaveBeenCalled();
    expect(correctionEvents[0]).toMatchObject({ entityId: "alpha", tickId: 2 });
  });

  it("delays snapshots until the reconciliation horizon elapses", async () => {
    let now = 0;
    const socket = new FakeWebSocket();
    const client = buildClient({
      socket,
      now: () => now,
      reconciliationDelayMs: 300,
    });

    await client.connect();

    const entity = encodeEntitySnapshot({
      entityId: "alpha",
      tickId: 1,
      capturedAtMs: 200,
      position: { x: 1, y: 2, z: 3 },
      orientation: { yawDeg: 10, pitchDeg: 0, rollDeg: 0 },
    });
    const world = encodeWorldSnapshot({
      tickId: 1,
      capturedAtMs: 200,
      entities: [entity],
    });

    now = 250;
    socket.simulateMessage(world);

    const before = client.getEntityState("alpha", 250);
    expect(before).toBeUndefined();

    now = 600;
    const after = client.getEntityState("alpha", 600);
    expect(after).toBeDefined();
    expect(after?.position.x).toBeCloseTo(1);
  });

  it("maintains smooth interpolation under 2% packet loss", async () => {
    const entityId = "alpha";
    const tickSpacingMs = 50;
    const totalSnapshots = 200;
    const expectedVelocityMetersPerMs = 0.04;
    const reconciliationDelayMs = 150;
    const rng = makeDeterministicRandom(0xdeadbeef);

    let now = 0;
    const socket = new FakeWebSocket();
    const client = buildClient({
      socket,
      now: () => now,
      reconciliationDelayMs,
      logger: { debug: () => {}, info: () => {}, warn: () => {} },
    });

    await client.connect();

    type ScheduledSnapshot = {
      capturedAt: number;
      deliveryAt: number;
      dropped: boolean;
      payload: Uint8Array;
    };

    const snapshots: ScheduledSnapshot[] = [];
    for (let index = 0; index < totalSnapshots; index += 1) {
      const capturedAt = index * tickSpacingMs;
      const position: Vector3 = { x: capturedAt * expectedVelocityMetersPerMs, y: 0, z: 0 };
      const orientation: Orientation = { yawDeg: 0, pitchDeg: 0, rollDeg: 0 };
      const payload = encodeWorldSnapshot({
        tickId: index + 1,
        capturedAtMs: capturedAt,
        keyframe: index === 0,
        entities: [
          encodeEntitySnapshot({
            entityId,
            tickId: index + 1,
            capturedAtMs: capturedAt,
            keyframe: index === 0,
            position,
            orientation,
          }),
        ],
      });

      const networkDelay = 60 + rng() * 40;
      const dropPacket = index !== 0 && rng() < 0.02;
      snapshots.push({
        capturedAt,
        deliveryAt: capturedAt + networkDelay,
        dropped: dropPacket,
        payload,
      });
    }

    //1.- Step the simulation clock in ascending order while injecting snapshots at their delivery time.
    snapshots.sort((a, b) => a.deliveryAt - b.deliveryAt);
    let delivered = 0;
    const sampleIntervalMs = 20;
    const samples: { time: number; position: number }[] = [];
    const endTime = snapshots[snapshots.length - 1]!.capturedAt + reconciliationDelayMs + 500;

    for (let currentTime = 0; currentTime <= endTime; currentTime += sampleIntervalMs) {
      now = currentTime;
      while (delivered < snapshots.length && snapshots[delivered]!.deliveryAt <= currentTime) {
        const snapshot = snapshots[delivered]!;
        now = snapshot.deliveryAt;
        if (!snapshot.dropped) {
          socket.simulateMessage(snapshot.payload);
        }
        delivered += 1;
      }

      const state = client.getEntityState(entityId, currentTime);
      if (state) {
        samples.push({ time: currentTime, position: state.position.x });
      }
    }

    //2.- Require a minimum sample density so the jitter measurement is meaningful.
    expect(samples.length).toBeGreaterThan(50);

    const warmupMs = reconciliationDelayMs * 2;
    const filtered = samples.filter((sample) => sample.time >= warmupMs);
    expect(filtered.length).toBeGreaterThan(40);

    //3.- Evaluate instantaneous velocity between successive samples and flag large deviations.
    let comparisons = 0;
    const deviations: number[] = [];
    for (let index = 1; index < filtered.length; index += 1) {
      const prev = filtered[index - 1]!;
      const next = filtered[index]!;
      const deltaTime = next.time - prev.time;
      if (deltaTime <= 0 || deltaTime > tickSpacingMs * 4) {
        continue;
      }
      const velocity = (next.position - prev.position) / deltaTime;
      const deviation = Math.abs(velocity - expectedVelocityMetersPerMs);
      comparisons += 1;
      deviations.push(deviation);
    }

    deviations.sort((a, b) => a - b);
    const p95 = deviations[Math.floor(Math.max(0, deviations.length - 1) * 0.95)] ?? 0;

    expect(comparisons).toBeGreaterThan(40);
    expect(p95).toBeLessThanOrEqual(0.07);
  });

  it("emits entity roster events for joins and despawns", async () => {
    let now = 0;
    const socket = new FakeWebSocket();
    const client = buildClient({ socket, now: () => now });

    await client.connect();

    now = 300;

    const join = encodeEntitySnapshot({
      entityId: "alpha",
      tickId: 1,
      capturedAtMs: 100,
      position: { x: 1, y: 0, z: 0 },
      orientation: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 },
      active: true,
    });
    socket.simulateMessage(
      encodeWorldSnapshot({
        tickId: 1,
        capturedAtMs: 100,
        entities: [join],
      }),
    );

    expect(client.hasKnownEntity("alpha")).toBe(true);
    expect(client.getKnownEntityIds()).toContain("alpha");

    now = 400;

    const leave = encodeEntitySnapshot({
      entityId: "alpha",
      tickId: 2,
      capturedAtMs: 200,
      position: { x: 0, y: 0, z: 0 },
      orientation: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 },
      active: false,
    });
    socket.simulateMessage(
      encodeWorldSnapshot({
        tickId: 2,
        capturedAtMs: 200,
        entities: [leave],
      }),
    );

    expect(client.hasKnownEntity("alpha")).toBe(false);
    expect(client.getKnownEntityIds()).not.toContain("alpha");
  });
});

