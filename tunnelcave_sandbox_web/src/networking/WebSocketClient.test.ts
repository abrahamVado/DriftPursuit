import { BinaryWriter } from "@bufbuild/protobuf/wire";
import { describe, expect, it, vi } from "vitest";

import type { Orientation, Vector3 } from "../../../typescript-client/src/generated/types";
import type { SocketDialOptions } from "./authenticatedSocket";
import { WebSocketClient, decodeWorldSnapshot, type CorrectionEventDetail } from "./WebSocketClient";

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
});

