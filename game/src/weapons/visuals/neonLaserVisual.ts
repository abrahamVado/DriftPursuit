import * as THREE from 'three';
import type { NeonLaserState } from '@/weapons/neonLaser';

export type NeonLaserPalette = {
  color: number;
};

const DEFAULT_FORWARD = new THREE.Vector3(0, 0, 1);
const TMP_DIRECTION = new THREE.Vector3();
const TMP_POSITION = new THREE.Vector3();
const TMP_QUATERNION = new THREE.Quaternion();

export type NeonLaserVisual = {
  update: (state: NeonLaserState) => void;
  dispose: () => void;
  readonly beam: THREE.Mesh;
};

export function createNeonLaserVisual(scene: THREE.Scene, palette: NeonLaserPalette = { color: 0x45ffff }): NeonLaserVisual {
  // Enhanced material: Switch to MeshStandardMaterial for emissive glow and light interaction.
  // Retain blending for overdraw, but add subtle metallic sheen.
  const material = new THREE.MeshStandardMaterial({
    color: palette.color,
    emissive: palette.color,
    emissiveIntensity: 0.4,
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    roughness: 0.05,
    metalness: 0.15
  });

  // Upgrade to CylinderGeometry for a sleek, beam-like shape with smooth radial segments.
  // Open-ended to avoid cap artifacts; pre-oriented and centered.
  const geometry = new THREE.CylinderGeometry(0.225, 0.225, 1, 12, 1, true); // Higher segments for smoothness
  geometry.rotateX(Math.PI / 2); // Align along Z
  geometry.translate(0, 0, -0.5); // Center for midpoint anchoring

  const beam = new THREE.Mesh(geometry, material);
  beam.visible = false;
  beam.receiveShadow = false;
  beam.castShadow = false; // Lasers shouldn't shadow
  scene.add(beam);

  function update(state: NeonLaserState) {
    // 1. Hide the beam outright when the weapon idles so the scene stays clean.
    if (!state.active || state.length <= 0) {
      beam.visible = false;
      return;
    }

    TMP_DIRECTION.copy(state.direction);
    if (TMP_DIRECTION.lengthSq() === 0) {
      beam.visible = false;
      return;
    }

    TMP_DIRECTION.normalize();
    beam.visible = true;

    // 2. Stretch the mesh along its forward axis to match the sampled range.
    // Add dynamic taper for depth illusion (wider at origin).
    const taperFactor = 0.85 + (state.length * 0.005);
    beam.scale.set(taperFactor, 1, state.length);

    // 3. Anchor the visual halfway between the muzzle and the measured hit point.
    TMP_POSITION.copy(state.origin).addScaledVector(TMP_DIRECTION, state.length * 0.5);
    beam.position.copy(TMP_POSITION);

    TMP_QUATERNION.setFromUnitVectors(DEFAULT_FORWARD, TMP_DIRECTION);
    beam.quaternion.copy(TMP_QUATERNION);

    // 4. Modulate the glow so attenuation directly affects the rendered opacity and emissive.
    // Smoother falloff curve for natural fade.
    const clamped = Math.max(0.2, Math.min(1, state.intensity));
    const falloff = Math.pow(clamped, 0.6); // Exponential for quicker tail-off
    material.opacity = 0.35 + falloff * 0.5;
    material.emissiveIntensity = 0.2 + falloff * 0.6;
    material.color.setScalar(0.55 + falloff * 0.45);
  }

  function dispose() {
    // 5. Release GPU buffers when the owning entity despawns to prevent leaks.
    scene.remove(beam);
    geometry.dispose();
    material.dispose();
  }

  return { update, dispose, beam };
}