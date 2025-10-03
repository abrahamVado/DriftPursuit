import type { InterpolatedState } from "../networking/interpolator";
import type { VehicleRosterEntry } from "../vehicleRoster";
import {
  Euler,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from "three";
import { VehicleGeometryFactory, type VehicleGeometryResult } from "./procedural/vehicleFactory";
import {
  CONTROL_PANEL_EVENT,
  type ControlPanelEvent,
  type ControlPanelIntent,
  type ControlPanelIntentDetail,
} from "./controlPanelEvents";

export interface VehicleStateSource extends EventTarget {
  getEntityState(entityId: string, nowMs?: number): InterpolatedState | undefined;
  getPlaybackBufferMs(): number;
}

export interface TransformInterpolatorContext {
  object: Object3D;
  state: InterpolatedState;
  previousState?: InterpolatedState;
  bufferMs: number;
  deltaMs: number;
}

export type TransformInterpolator = (context: TransformInterpolatorContext) => void;

export interface VehicleSceneManagerOptions {
  client: VehicleStateSource;
  factory: VehicleGeometryFactory;
  now?: () => number;
  controlPanel?: EventTarget;
  bridgeBaseUrl?: string;
  fetch?: typeof fetch;
  interpolateTransform?: TransformInterpolator;
}

interface VehicleInstance {
  entityId: string;
  group: Group;
  metadata: VehicleGeometryResult["metadata"];
  lastState?: InterpolatedState;
  lastUpdateMs?: number;
}

function normaliseBaseUrl(url?: string): string {
  //1.- Trim whitespace and drop trailing slashes so request URLs remain stable.
  const trimmed = (url ?? "").trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/\/+$/, "");
}

function cloneState(state: InterpolatedState): InterpolatedState {
  //1.- Create a defensive copy so historical state snapshots remain immutable.
  return {
    tickId: state.tickId,
    keyframe: state.keyframe,
    capturedAtMs: state.capturedAtMs,
    position: {
      x: state.position?.x ?? 0,
      y: state.position?.y ?? 0,
      z: state.position?.z ?? 0,
    },
    orientation: {
      yawDeg: state.orientation?.yawDeg ?? 0,
      pitchDeg: state.orientation?.pitchDeg ?? 0,
      rollDeg: state.orientation?.rollDeg ?? 0,
    },
  };
}

export class VehicleSceneManager {
  private readonly client: VehicleStateSource;
  private readonly factory: VehicleGeometryFactory;
  private readonly now: () => number;
  private readonly interpolate: TransformInterpolator;
  private readonly bridgeBaseUrl: string;
  private readonly fetchImpl?: typeof fetch;
  private readonly controlPanel?: EventTarget;
  private readonly vehicles = new Map<string, VehicleInstance>();
  private controlPanelListener?: (event: Event) => void;

  constructor(options: VehicleSceneManagerOptions) {
    if (!options?.client) {
      throw new Error("VehicleSceneManager requires a client instance");
    }
    if (!options?.factory) {
      throw new Error("VehicleSceneManager requires a vehicle factory instance");
    }
    //1.- Persist the injected collaborators so update cycles can access them cheaply.
    this.client = options.client;
    this.factory = options.factory;
    this.now = options.now ?? (() => Date.now());
    this.interpolate = options.interpolateTransform ?? ((context) => this.applyDefaultInterpolation(context));
    this.bridgeBaseUrl = normaliseBaseUrl(
      options.bridgeBaseUrl ?? process.env.NEXT_PUBLIC_SIM_BRIDGE_URL ?? "",
    );
    this.fetchImpl = options.fetch ?? (typeof fetch === "function" ? fetch : undefined);
    this.controlPanel = options.controlPanel;

    if (this.controlPanel) {
      //2.- Subscribe to UI emitted intents so control POSTs mirror on-screen interactions.
      this.controlPanelListener = (event: Event) => {
        const detail = (event as ControlPanelEvent)?.detail;
        if (!detail) {
          return;
        }
        void this.dispatchControlIntent(detail);
      };
      this.controlPanel.addEventListener(
        CONTROL_PANEL_EVENT,
        this.controlPanelListener as EventListener,
      );
    }
  }

  async register(
    entityId: string,
    rosterEntry: VehicleRosterEntry,
    loadoutId?: string,
  ): Promise<VehicleInstance> {
    //1.- Avoid recreating meshes when the entity is already tracked.
    if (!entityId) {
      throw new Error("entityId is required to register a vehicle");
    }
    const existing = this.vehicles.get(entityId);
    if (existing) {
      return existing;
    }
    const geometry = await this.factory.createFromRoster(rosterEntry, loadoutId);
    const instance = this.buildInstance(entityId, geometry);
    this.vehicles.set(entityId, instance);
    return instance;
  }

  getVehicle(entityId: string): VehicleInstance | undefined {
    //1.- Surface the tracked instance so scene callers can attach it to the graph.
    return this.vehicles.get(entityId);
  }

  remove(entityId: string): void {
    //1.- Remove the entity from the scene graph map and detach it from any parent.
    const instance = this.vehicles.get(entityId);
    if (!instance) {
      return;
    }
    instance.group.removeFromParent();
    this.vehicles.delete(entityId);
  }

  update(nowMs?: number): void {
    //1.- Bail out quickly when no vehicles are tracked to keep idle frames cheap.
    if (this.vehicles.size === 0) {
      return;
    }
    const timestamp = nowMs ?? this.now();
    const bufferMs = this.client.getPlaybackBufferMs();
    for (const instance of this.vehicles.values()) {
      const state = this.client.getEntityState(instance.entityId, timestamp);
      if (!state) {
        instance.group.visible = false;
        instance.lastState = undefined;
        instance.lastUpdateMs = undefined;
        continue;
      }
      instance.group.visible = true;
      const deltaMs = instance.lastUpdateMs !== undefined ? Math.max(0, timestamp - instance.lastUpdateMs) : 0;
      this.interpolate({
        object: instance.group,
        state,
        previousState: instance.lastState,
        bufferMs,
        deltaMs,
      });
      instance.lastState = cloneState(state);
      instance.lastUpdateMs = timestamp;
    }
  }

  dispose(): void {
    //1.- Detach event listeners and clear tracked vehicle state for clean shutdowns.
    if (this.controlPanel && this.controlPanelListener) {
      this.controlPanel.removeEventListener(
        CONTROL_PANEL_EVENT,
        this.controlPanelListener as EventListener,
      );
      this.controlPanelListener = undefined;
    }
    for (const instance of this.vehicles.values()) {
      instance.group.removeFromParent();
    }
    this.vehicles.clear();
  }

  private buildInstance(entityId: string, geometry: VehicleGeometryResult): VehicleInstance {
    //1.- Create the scene graph hierarchy combining body, wheels, and spoiler meshes.
    const bodyMaterial = new MeshStandardMaterial({ color: 0x1f2937, metalness: 0.4, roughness: 0.6 });
    const wheelMaterial = new MeshStandardMaterial({ color: 0x0f172a, metalness: 0.2, roughness: 0.8 });
    const spoilerMaterial = new MeshStandardMaterial({ color: 0xf97316, metalness: 0.3, roughness: 0.4 });

    const body = new Mesh(geometry.body, bodyMaterial);
    const wheelOffsets: Array<[number, number]> = [];
    const dimensions = geometry.metadata.dimensions;
    const halfBase = (dimensions?.wheelBase ?? 0) / 2;
    const halfTrack = (dimensions?.wheelTrack ?? 0) / 2;
    if (halfBase > 0 && halfTrack > 0) {
      wheelOffsets.push([halfBase, halfTrack]);
      wheelOffsets.push([halfBase, -halfTrack]);
      wheelOffsets.push([-halfBase, halfTrack]);
      wheelOffsets.push([-halfBase, -halfTrack]);
    }
    const wheels = wheelOffsets.map(([x, z]) => {
      const wheel = new Mesh(geometry.wheel, wheelMaterial);
      wheel.position.set(x, 0, z);
      return wheel;
    });
    const spoiler = new Mesh(geometry.spoiler, spoilerMaterial);

    const group = new Group();
    group.name = `vehicle:${geometry.metadata.vehicleId ?? entityId}`;
    group.matrixAutoUpdate = false;
    group.userData.metadata = geometry.metadata;
    group.visible = false;
    group.add(body, spoiler, ...wheels);

    return {
      entityId,
      group,
      metadata: geometry.metadata,
    };
  }

  private applyDefaultInterpolation(context: TransformInterpolatorContext): void {
    //1.- Establish the target position and orientation based on the interpolated state.
    const targetPosition = new Vector3(
      context.state.position?.x ?? 0,
      context.state.position?.y ?? 0,
      context.state.position?.z ?? 0,
    );
    const targetEuler = new Euler(
      MathUtils.degToRad(context.state.orientation?.pitchDeg ?? 0),
      MathUtils.degToRad(context.state.orientation?.yawDeg ?? 0),
      MathUtils.degToRad(context.state.orientation?.rollDeg ?? 0),
      "YXZ",
    );
    const targetQuaternion = new Quaternion().setFromEuler(targetEuler);

    if (!context.previousState) {
      //2.- Snap immediately when the instance has no historical frame yet.
      context.object.position.copy(targetPosition);
      context.object.quaternion.copy(targetQuaternion);
      context.object.updateMatrix();
      return;
    }

    const smoothing = context.bufferMs > 0 ? Math.min(1, context.deltaMs / context.bufferMs) : 1;
    if (smoothing <= 0) {
      context.object.updateMatrix();
      return;
    }

    context.object.position.lerp(targetPosition, smoothing);
    context.object.quaternion.slerp(targetQuaternion, smoothing);
    context.object.updateMatrix();
  }

  private async dispatchControlIntent(detail: ControlPanelIntentDetail): Promise<void> {
    //1.- Ignore intents when networking hooks are unavailable or the payload is malformed.
    if (!this.fetchImpl || !this.bridgeBaseUrl || !detail?.control) {
      return;
    }
    const issuedAtMs = detail.issuedAtMs ?? this.now();
    let value = Number(detail.value ?? 0);
    switch (detail.control) {
      case "throttle":
        value = Math.min(Math.max(value, 0), 1);
        break;
      case "brake":
        value = Math.min(Math.max(value, 0), 1);
        break;
      case "steer":
        value = Math.min(Math.max(value, -1), 1);
        break;
      default:
        return;
    }
    const payload = {
      command: detail.control,
      value,
      issuedAtMs,
      playbackBufferMs: this.client.getPlaybackBufferMs(),
      source: "control-panel",
    };
    try {
      await this.fetchImpl(`${this.bridgeBaseUrl}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      //2.- Suppress network errors to avoid crashing animation loops when the bridge is offline.
      console.warn("control intent dispatch failed", error);
    }
  }
}

export type VehicleSceneInstance = VehicleInstance;
