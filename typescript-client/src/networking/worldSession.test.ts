import { BinaryWriter } from "@bufbuild/protobuf/wire";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../planet_sandbox_web/src/networking/authenticatedSocket", () => {
  //1.- Replace the dial helper so tests can intercept outbound websocket connections.
  return {
    openAuthenticatedSocket: vi.fn(),
  };
});

import { openAuthenticatedSocket } from "../../../planet_sandbox_web/src/networking/authenticatedSocket";
import type { Orientation, Vector3 } from "../generated/types";
import { createWorldSession, type EntityTransform } from "./worldSession";

function ensureCustomEvent(): void {
  //1.- Node lacks CustomEvent in some environments; introduce a minimal shim for EventTarget consumers.
  if (typeof globalThis.CustomEvent === "function") {
    return;
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

function createMockSocket() {
  let closed = false;
  let openHandler: (() => void) | null = null;
  let closeHandler: ((event: { code?: number; reason?: string }) => void) | null = null;
  let messageHandler: ((event: { data: unknown }) => void) | null = null;

  return {
    binaryType: "arraybuffer" as const,
    set onopen(handler: (() => void) | null) {
      openHandler = handler;
    },
    set onclose(handler: ((event: { code?: number; reason?: string }) => void) | null) {
      closeHandler = handler;
    },
    set onmessage(handler: ((event: { data: unknown }) => void) | null) {
      messageHandler = handler;
    },
    set onerror(_: ((event: unknown) => void) | null) {
      //1.- No-op for tests; error flow is validated in other suites.
    },
    close(code?: number, reason?: string) {
      if (closed) {
        return;
      }
      closed = true;
      closeHandler?.({ code, reason });
    },
    send(): void {
      //1.- Intentionally blank. Outbound messaging is not exercised in these tests.
    },
    triggerOpen() {
      openHandler?.();
    },
    triggerMessage(data: unknown) {
      messageHandler?.({ data });
    },
    wasClosed(): boolean {
      return closed;
    },
  };
}

function encodeVector3(value: Vector3): Uint8Array {
  const writer = new BinaryWriter();
  writer.uint32((1 << 3) | 1).double(value.x);
  writer.uint32((2 << 3) | 1).double(value.y);
  writer.uint32((3 << 3) | 1).double(value.z);
  return writer.finish();
}

function encodeOrientation(value: Orientation): Uint8Array {
  const writer = new BinaryWriter();
  writer.uint32((1 << 3) | 1).double(value.yawDeg);
  writer.uint32((2 << 3) | 1).double(value.pitchDeg);
  writer.uint32((3 << 3) | 1).double(value.rollDeg);
  return writer.finish();
}

function encodeEntitySnapshot(params: {
  entityId: string;
  tickId: number;
  capturedAtMs: number;
  keyframe: boolean;
  position: Vector3;
  orientation: Orientation;
  active?: boolean;
}): Uint8Array {
  const writer = new BinaryWriter();
  writer.uint32((2 << 3) | 2).string(params.entityId);
  writer.uint32((4 << 3) | 2).bytes(encodeVector3(params.position));
  writer.uint32((6 << 3) | 2).bytes(encodeOrientation(params.orientation));
  writer.uint32((10 << 3) | 0).int64(BigInt(params.capturedAtMs));
  writer.uint32((11 << 3) | 0).uint64(BigInt(params.tickId));
  writer.uint32((12 << 3) | 0).bool(params.keyframe);
  if (params.active !== undefined) {
    writer.uint32((8 << 3) | 0).bool(params.active);
  }
  return writer.finish();
}

function encodeWorldSnapshot(params: {
  tickId: number;
  capturedAtMs: number;
  keyframe: boolean;
  entities: Uint8Array[];
}): Uint8Array {
  const writer = new BinaryWriter();
  writer.uint32((2 << 3) | 0).int64(BigInt(params.capturedAtMs));
  for (const entity of params.entities) {
    writer.uint32((3 << 3) | 2).bytes(entity);
  }
  writer.uint32((6 << 3) | 0).uint64(BigInt(params.tickId));
  writer.uint32((7 << 3) | 0).bool(params.keyframe);
  return writer.finish();
}

function collect(storeSubscription: (listener: (snapshot: ReadonlyMap<string, EntityTransform>) => void) => () => void) {
  const frames: ReadonlyMap<string, EntityTransform>[] = [];
  const unsubscribe = storeSubscription((snapshot) => {
    frames.push(new Map(snapshot));
  });
  return { frames, unsubscribe };
}

describe("worldSession", () => {
  beforeEach(() => {
    ensureCustomEvent();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it("streams binary snapshots into the reactive store", async () => {
    const socket = createMockSocket();
    const mocked = vi.mocked(openAuthenticatedSocket);
    mocked.mockResolvedValue(socket as unknown as WebSocket);

    let nowMs = 1_000;
    const session = createWorldSession({
      dial: {
        url: "ws://example.test/ws",
        auth: { subject: "pilot", secret: "shh" },
      },
      updateIntervalMs: 25,
      now: () => nowMs,
    });

    const { frames, unsubscribe } = collect(session.store.subscribe.bind(session.store));

    await session.connect();
    socket.triggerOpen();

    const release = session.trackEntity("alpha");

    nowMs = 1_050;
    socket.triggerMessage(
      encodeWorldSnapshot({
        tickId: 100,
        capturedAtMs: 900,
        keyframe: true,
        entities: [
          encodeEntitySnapshot({
            entityId: "alpha",
            tickId: 100,
            capturedAtMs: 900,
            keyframe: true,
            position: { x: 0, y: 0, z: 0 },
            orientation: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 },
          }),
        ],
      }),
    );

    nowMs = 1_200;
    vi.advanceTimersByTime(50);

    nowMs = 1_250;
    socket.triggerMessage(
      encodeWorldSnapshot({
        tickId: 120,
        capturedAtMs: 1_050,
        keyframe: false,
        entities: [
          encodeEntitySnapshot({
            entityId: "alpha",
            tickId: 120,
            capturedAtMs: 1_050,
            keyframe: false,
            position: { x: 10, y: 0, z: 0 },
            orientation: { yawDeg: 5, pitchDeg: 0, rollDeg: 0 },
          }),
        ],
      }),
    );

    nowMs = 1_400;
    vi.advanceTimersByTime(50);

    expect(frames.length).toBeGreaterThan(1);
    const latest = frames[frames.length - 1];
    const alpha = latest.get("alpha");
    expect(alpha).toBeDefined();
    expect(alpha?.tickId).toBe(120);
    expect(alpha?.position.x).toBeCloseTo(10);
    expect(alpha?.orientation.yawDeg).toBeCloseTo(5);

    release();
    unsubscribe();
    session.dispose();
  });

  it("cleans up timers and sockets during dispose", async () => {
    const socket = createMockSocket();
    const mocked = vi.mocked(openAuthenticatedSocket);
    mocked.mockResolvedValue(socket as unknown as WebSocket);

    let nowMs = 500;
    const session = createWorldSession({
      dial: {
        url: "ws://example.test/ws",
        auth: { subject: "pilot", token: "issued" },
      },
      updateIntervalMs: 10,
      now: () => nowMs,
    });

    await session.connect();
    socket.triggerOpen();
    const release = session.trackEntity("alpha");

    expect(vi.getTimerCount()).toBeGreaterThan(0);

    session.dispose();
    expect(socket.wasClosed()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    release();
  });

  it("auto tracks broker entities so every player shares the same world", async () => {
    //1.- Arrange the mocked socket transport so the session can observe broker snapshots without networking.
    const socket = createMockSocket();
    vi.mocked(openAuthenticatedSocket).mockResolvedValue(socket as unknown as WebSocket);

    let nowMs = 2_000;
    const session = createWorldSession({
      dial: {
        url: "ws://example.test/ws",
        auth: { subject: "pilot", secret: "bridge" },
      },
      updateIntervalMs: 25,
      now: () => nowMs,
    });

    const { frames, unsubscribe } = collect(session.store.subscribe.bind(session.store));

    //2.- Establish the websocket connection to trigger roster events on the client wrapper.
    await session.connect();
    socket.triggerOpen();

    nowMs = 2_050;
    socket.triggerMessage(
      encodeWorldSnapshot({
        tickId: 42,
        capturedAtMs: 1_900,
        keyframe: true,
        entities: [
          encodeEntitySnapshot({
            entityId: "bravo",
            tickId: 42,
            capturedAtMs: 1_900,
            keyframe: true,
            position: { x: 5, y: 0, z: 0 },
            orientation: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 },
          }),
        ],
      }),
    );

    nowMs = 2_150;
    vi.advanceTimersByTime(50);

    const latest = frames[frames.length - 1];
    expect(latest?.has("bravo")).toBe(true);

    //3.- Publish a despawn snapshot so the auto tracker prunes the entity for everyone.
    socket.triggerMessage(
      encodeWorldSnapshot({
        tickId: 43,
        capturedAtMs: 2_000,
        keyframe: true,
        entities: [
          encodeEntitySnapshot({
            entityId: "bravo",
            tickId: 43,
            capturedAtMs: 2_000,
            keyframe: true,
            position: { x: 0, y: 0, z: 0 },
            orientation: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 },
            active: false,
          }),
        ],
      }),
    );

    nowMs = 2_250;
    vi.advanceTimersByTime(50);

    const final = frames[frames.length - 1];
    expect(final?.has("bravo")).toBe(false);

    unsubscribe();
    session.dispose();
  });
});
