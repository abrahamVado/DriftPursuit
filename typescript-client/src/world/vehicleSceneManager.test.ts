import { describe, expect, it, vi } from "vitest";
import type { InterpolatedState } from "../networking/interpolator";
import type { VehicleRosterEntry } from "../vehicleRoster";
import { VehicleGeometryFactory } from "./procedural/vehicleFactory";
import { CONTROL_PANEL_EVENT, type ControlPanelIntentDetail } from "./controlPanelEvents";
import { VehicleSceneManager, type VehicleStateSource } from "./vehicleSceneManager";

class MockStateSource extends EventTarget implements VehicleStateSource {
  private readonly states = new Map<string, InterpolatedState>();
  playbackBufferMs = 125;

  setState(entityId: string, state?: InterpolatedState): void {
    if (!state) {
      this.states.delete(entityId);
      return;
    }
    this.states.set(entityId, state);
  }

  getEntityState(entityId: string): InterpolatedState | undefined {
    return this.states.get(entityId);
  }

  getPlaybackBufferMs(): number {
    return this.playbackBufferMs;
  }
}

function createRosterEntry(id: string): VehicleRosterEntry {
  //1.- Provide a lightweight roster entry with deterministic stats for geometry generation.
  return {
    id,
    displayName: id,
    stats: {
      maxSpeedMps: 80,
      maxAngularSpeedDegPerSec: 120,
      forwardAccelerationMps2: 10,
      reverseAccelerationMps2: 6,
      strafeAccelerationMps2: 8,
      verticalAccelerationMps2: 5,
      boostAccelerationMps2: 18,
      boostDurationSeconds: 5,
      boostCooldownSeconds: 12,
    },
    selectable: true,
    loadouts: [],
  };
}

describe("VehicleSceneManager", () => {
  it("updates vehicle transforms using WebSocket state", async () => {
    const client = new MockStateSource();
    const factory = new VehicleGeometryFactory();
    let nowMs = 1_000;
    const manager = new VehicleSceneManager({
      client,
      factory,
      now: () => nowMs,
    });
    const roster = createRosterEntry("alpha");
    const instance = await manager.register("entity-alpha", roster);

    const state: InterpolatedState = {
      tickId: 1,
      keyframe: true,
      capturedAtMs: 900,
      position: { x: 5, y: 2, z: -3 },
      orientation: { yawDeg: 45, pitchDeg: 10, rollDeg: -5 },
    };
    client.setState("entity-alpha", state);

    manager.update();
    expect(instance.group.visible).toBe(true);
    expect(instance.group.position.x).toBeCloseTo(5);
    expect(instance.group.position.y).toBeCloseTo(2);
    expect(instance.group.position.z).toBeCloseTo(-3);

    const next: InterpolatedState = {
      tickId: 2,
      keyframe: false,
      capturedAtMs: 950,
      position: { x: 6, y: 1, z: -4 },
      orientation: { yawDeg: 90, pitchDeg: 0, rollDeg: 0 },
    };
    client.setState("entity-alpha", next);
    nowMs += 125;
    manager.update();

    expect(instance.group.position.x).toBeCloseTo(6, 5);
    expect(instance.group.quaternion.length()).toBeCloseTo(1, 5);

    client.setState("entity-alpha", undefined);
    nowMs += 50;
    manager.update();
    expect(instance.group.visible).toBe(false);

    manager.dispose();
  });

  it("invokes custom interpolators with buffer latency feedback", async () => {
    const client = new MockStateSource();
    client.playbackBufferMs = 200;
    const factory = new VehicleGeometryFactory();
    let nowMs = 5_000;
    const interpolator = vi.fn((context) => {
      context.object.position.set(
        context.state.position?.x ?? 0,
        context.state.position?.y ?? 0,
        context.state.position?.z ?? 0,
      );
      context.object.updateMatrix();
    });
    const manager = new VehicleSceneManager({
      client,
      factory,
      now: () => nowMs,
      interpolateTransform: interpolator,
    });
    await manager.register("entity-bravo", createRosterEntry("bravo"));

    const first: InterpolatedState = {
      tickId: 10,
      keyframe: true,
      capturedAtMs: 4_800,
      position: { x: 1, y: 0, z: 0 },
      orientation: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 },
    };
    client.setState("entity-bravo", first);
    manager.update();

    const second: InterpolatedState = {
      tickId: 11,
      keyframe: false,
      capturedAtMs: 4_850,
      position: { x: 2, y: 0, z: 0 },
      orientation: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 },
    };
    client.setState("entity-bravo", second);
    nowMs += 100;
    manager.update();

    expect(interpolator).toHaveBeenCalledTimes(2);
    const lastCall = interpolator.mock.calls.at(-1);
    expect(lastCall?.[0].bufferMs).toBe(200);
    expect(lastCall?.[0].deltaMs).toBe(100);

    manager.dispose();
  });

  it("dispatches HTTP POST commands when control intents fire", async () => {
    const client = new MockStateSource();
    client.playbackBufferMs = 90;
    const factory = new VehicleGeometryFactory();
    const controlPanel = new EventTarget();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const manager = new VehicleSceneManager({
      client,
      factory,
      controlPanel,
      fetch: fetchMock as unknown as typeof fetch,
      bridgeBaseUrl: "http://localhost:8000/",
      now: () => 42,
    });

    const throttleIntent: ControlPanelIntentDetail = { control: "throttle", value: 2 };
    controlPanel.dispatchEvent(new CustomEvent(CONTROL_PANEL_EVENT, { detail: throttleIntent }));
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall[0]).toBe("http://localhost:8000/command");
    const firstBody = JSON.parse(firstCall[1]?.body ?? "{}");
    expect(firstBody.command).toBe("throttle");
    expect(firstBody.value).toBe(1);
    expect(firstBody.issuedAtMs).toBe(42);
    expect(firstBody.playbackBufferMs).toBe(90);

    const steerIntent: ControlPanelIntentDetail = { control: "steer", value: -2, issuedAtMs: 99 };
    controlPanel.dispatchEvent(new CustomEvent(CONTROL_PANEL_EVENT, { detail: steerIntent }));
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body ?? "{}");
    expect(secondBody.command).toBe("steer");
    expect(secondBody.value).toBe(-1);
    expect(secondBody.issuedAtMs).toBe(99);

    manager.dispose();
  });
});
