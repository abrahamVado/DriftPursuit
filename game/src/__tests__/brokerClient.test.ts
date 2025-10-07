import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrokerClient, OBSERVER_SCHEMA_VERSION } from "@/lib/brokerClient";
import * as brokerConfig from "@/lib/brokerConfig";

class MockWebSocket extends EventTarget {
  static instances: MockWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    super();
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  //1.- Capture outbound payloads for assertions instead of sending them across the network.
  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    const event = new Event("open");
    this.dispatchEvent(event);
    this.onopen?.(event);
  }

  simulateMessage(payload: string) {
    const event = new MessageEvent("message", { data: payload });
    this.dispatchEvent(event);
    this.onmessage?.(event);
  }

  static reset() {
    MockWebSocket.instances = [];
  }
}

describe("broker client", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    //2.- Force the client to use the mock implementation and a deterministic broker endpoint.
    (globalThis as any).WebSocket = MockWebSocket as unknown as typeof WebSocket;
    vi.spyOn(brokerConfig, "getBrokerConfig").mockReturnValue({
      wsUrl: "ws://example.test/ws",
      httpUrl: "http://example.test",
    });
    MockWebSocket.reset();
  });

  afterEach(() => {
    //3.- Restore globals so the mocked websocket does not leak across suites.
    (globalThis as any).WebSocket = originalWebSocket;
    vi.restoreAllMocks();
    MockWebSocket.reset();
  });

  it("sends a handshake and dispatches world diffs", () => {
    const client = createBrokerClient({ clientId: "test-pilot", reconnectDelayMs: 0 });
    const socket = MockWebSocket.instances[0];
    if (!socket) {
      throw new Error("expected websocket to be constructed");
    }

    let receivedTick = 0;
    const unsubscribe = client.onWorldDiff((diff) => {
      receivedTick = diff.tick;
    });

    socket.simulateOpen();
    expect(socket.sent.length).toBeGreaterThan(0);
    const handshake = JSON.parse(socket.sent[0]);
    expect(handshake).toMatchObject({
      type: "observer_state",
      id: "test-pilot",
      schema_version: OBSERVER_SCHEMA_VERSION,
    });

    socket.simulateMessage(JSON.stringify({ type: "world_diff", tick: 42 }));
    expect(receivedTick).toBe(42);

    unsubscribe();
    client.close();
  });

  it("queues intents until the socket opens", () => {
    const client = createBrokerClient({ clientId: "queued-pilot", reconnectDelayMs: 0 });
    const socket = MockWebSocket.instances[0];
    if (!socket) {
      throw new Error("expected websocket to be constructed");
    }

    //4.- Capture the intent payload produced prior to the websocket transitioning to OPEN.
    client.sendIntent({
      throttle: 1,
      brake: 0,
      steer: 0.2,
      handbrake: false,
      gear: 3,
      boost: false,
    });
    expect(socket.sent).toHaveLength(0);

    socket.simulateOpen();
    expect(socket.sent.length).toBeGreaterThan(0);
    const payload = JSON.parse(socket.sent.at(-1) ?? "{}");
    expect(payload).toMatchObject({
      type: "intent",
      controller_id: "queued-pilot",
      sequence_id: 1,
      throttle: 1,
      steer: 0.2,
    });

    client.close();
  });

  it("closes sockets that are still connecting", () => {
    const client = createBrokerClient({ clientId: "closing-pilot", reconnectDelayMs: 0 });
    const socket = MockWebSocket.instances[0];
    if (!socket) {
      throw new Error("expected websocket to be constructed");
    }

    //5.- Validate that terminating during CONNECTING invokes close() and suppresses the broker handshake.
    const closeSpy = vi.spyOn(socket, "close");
    client.close();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);

    socket.simulateOpen();
    expect(socket.sent).toHaveLength(0);
  });
});
