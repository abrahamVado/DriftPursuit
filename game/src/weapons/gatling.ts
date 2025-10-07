import * as THREE from 'three';
import { WeaponContext } from '@/weapons/types';

export type GatlingOptions = {
  fireRate: number;
  spread: number;
  maxTracers: number;
  tracerLifeMs: number;
  ammo: number;
  heatPerShot: number;
  coolRate: number;
  overheatThreshold: number;
};

export type TracerState = {
  id: number;
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  lifeMs: number;
};

export type GatlingState = {
  ammo: number;
  heat: number;
  overheated: boolean;
  tracers: TracerState[];
  accumulator: number;
};

export type GatlingPalette = {
  tracerColor: number;
  heatColor?: number; // Optional for overheat tint
};

const DEFAULT_FORWARD = new THREE.Vector3(0, 0, 1);
const TMP_DIRECTION = new THREE.Vector3();
const TMP_POSITION = new THREE.Vector3();
const TMP_QUATERNION = new THREE.Quaternion();

export function createGatlingSystem(options: GatlingOptions) {
  const state: GatlingState = {
    ammo: options.ammo,
    heat: 0,
    overheated: false,
    tracers: [],
    accumulator: 0,
  };
  let tracerId = 0;

  function spawnTracer(context: WeaponContext) {
    const tracer: TracerState = {
      id: ++tracerId,
      origin: context.position.clone(),
      direction: context.forward.clone(),
      lifeMs: options.tracerLifeMs,
    };
    // 1. Impose deterministic spread so tests can predictably assert ray casts.
    const seed = tracer.id * 12.9898;
    const yaw = (Math.sin(seed) * 0.5) * options.spread;
    const pitch = (Math.sin(seed * 0.5) * 0.5) * options.spread;
    const rotation = new THREE.Euler(pitch, yaw, 0, 'XYZ');
    tracer.direction.applyEuler(rotation).normalize();
    if (state.tracers.length >= options.maxTracers) {
      state.tracers.shift();
    }
    state.tracers.push(tracer);
    return tracer;
  }

  function coolDown(dt: number) {
    // 2. Dissipate heat over time so prolonged bursts eventually recover.
    if (state.heat > 0) {
      state.heat = Math.max(0, state.heat - options.coolRate * dt);
      if (state.overheated && state.heat <= options.overheatThreshold * 0.25) {
        state.overheated = false;
      }
    }
  }

  function update(context: WeaponContext, triggerHeld: boolean) {
    const dt = context.dt;
    for (let i = state.tracers.length - 1; i >= 0; i--) {
      const tracer = state.tracers[i];
      tracer.lifeMs -= dt * 1000;
      if (tracer.lifeMs <= 0) {
        state.tracers.splice(i, 1);
      }
    }
    if (!triggerHeld) {
      // 3. When idle, only cool the barrels.
      coolDown(dt);
      state.accumulator = 0;
      return { shots: 0 };
    }
    if (state.overheated || state.ammo <= 0) {
      coolDown(dt);
      return { shots: 0 };
    }
    state.accumulator += dt * options.fireRate;
    let shots = 0;
    while (state.accumulator >= 1 && state.ammo > 0 && !state.overheated) {
      spawnTracer(context);
      state.accumulator -= 1;
      state.ammo -= 1;
      state.heat += options.heatPerShot;
      shots++;
      if (state.heat >= options.overheatThreshold) {
        // 4. Flag the weapon as overheated so callers must ease off the trigger.
        state.overheated = true;
      }
    }
    coolDown(dt);
    return { shots };
  }

  return {
    update,
    get state() { return state; },
    get ammo() { return state.ammo; },
    get overheated() { return state.overheated; },
  };
}

export type GatlingVisual = {
  update: (state: GatlingState) => void;
  dispose: () => void;
  readonly tracers: THREE.Mesh[];
};

export function createGatlingVisual(scene: THREE.Scene, options: GatlingOptions, palette: GatlingPalette = { tracerColor: 0xffff00 }): GatlingVisual {
  const tracers: THREE.Mesh[] = [];
  const tracerSpeed = 200; // Assumed units/sec for tracer travel; tweak as needed
  const tracerLength = 1; // Fixed segment length for visibility

  // Pre-create maxTracers meshes for reuse (pooling for perf)
  for (let i = 0; i < options.maxTracers; i++) {
    const material = new THREE.MeshBasicMaterial({
      color: palette.tracerColor,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const geometry = new THREE.BoxGeometry(0.1, 0.1, tracerLength);
    geometry.translate(0, 0, -tracerLength / 2); // Center the segment
    const tracer = new THREE.Mesh(geometry, material);
    tracer.visible = false;
    scene.add(tracer);
    tracers.push(tracer);
  }

  let activeTracerIndex = 0; // For cycling through pool

  function update(state: GatlingState) {
    // 1. Update existing tracers: Move forward, fade, and hide expired ones.
    for (let i = 0; i < state.tracers.length; i++) {
      const tracerState = state.tracers[i];
      const tracerMesh = tracers[activeTracerIndex];
      activeTracerIndex = (activeTracerIndex + 1) % options.maxTracers;

      if (tracerState.lifeMs <= 0) {
        tracerMesh.visible = false;
        continue;
      }

      TMP_DIRECTION.copy(tracerState.direction).normalize();
      tracerMesh.visible = true;

      // 2. Position: Start at origin, advance based on elapsed time.
      const elapsed = (options.tracerLifeMs - tracerState.lifeMs) / 1000; // Sec since spawn
      TMP_POSITION.copy(tracerState.origin).addScaledVector(TMP_DIRECTION, tracerSpeed * elapsed);
      tracerMesh.position.copy(TMP_POSITION);

      // 3. Orient to direction.
      TMP_QUATERNION.setFromUnitVectors(DEFAULT_FORWARD, TMP_DIRECTION);
      tracerMesh.quaternion.copy(TMP_QUATERNION);

      // 4. Fade opacity over life.
      const progress = 1 - (tracerState.lifeMs / options.tracerLifeMs);
      (tracerMesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - progress);

      // Optional: Modulate for heat (global overheat tint).
      if (state.overheated && palette.heatColor) {
        (tracerMesh.material as THREE.MeshBasicMaterial).color.setHex(palette.heatColor);
      } else {
        (tracerMesh.material as THREE.MeshBasicMaterial).color.setHex(palette.tracerColor);
      }
    }

    // Hide unused tracers.
    for (let i = state.tracers.length; i < options.maxTracers; i++) {
      tracers[i % options.maxTracers].visible = false;
    }
  }

  function dispose() {
    // 5. Release GPU buffers when the owning entity despawns to prevent leaks.
    tracers.forEach(tracer => {
      scene.remove(tracer);
      tracer.geometry.dispose();
      tracer.material.dispose();
    });
  }

  return { update, dispose, tracers };
}