import * as THREE from 'three';
import type { GatlingState, GatlingOptions } from '@/weapons/gatling'; // Adjust import path as needed

export type GatlingPalette = {
  tracerColor: number;
  heatColor?: number; // Optional for overheat tint
};

const DEFAULT_FORWARD = new THREE.Vector3(0, 0, 1);
const TMP_DIRECTION = new THREE.Vector3();
const TMP_POSITION = new THREE.Vector3();
const TMP_QUATERNION = new THREE.Quaternion();

export type GatlingVisual = {
  update: (state: GatlingState) => void;
  dispose: () => void;
  readonly tracers: THREE.Mesh[]; // Array of tracer meshes
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