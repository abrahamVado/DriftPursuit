import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyEnvironmentVectorAttenuation, getDifficultyState } from '@/engine/difficulty';

export type EnemyDifficultyContext = ReturnType<typeof getDifficultyState>;
export type EnemyOptions = {
  difficulty?: EnemyDifficultyContext;
  variant?: 'pursuer' | 'strafer' | 'sentry';
};

function disposeMeshLike(object: THREE.Object3D) {
  // 1. Traverse any composed mesh tree and release GPU buffers and materials.
  const disposedMaterials = new Set<THREE.Material>();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const material = child.material;
    if (Array.isArray(material)) {
      for (const mat of material) {
        if (!disposedMaterials.has(mat)) {
          mat.dispose?.();
          disposedMaterials.add(mat);
        }
      }
    } else if (!disposedMaterials.has(material)) {
      material.dispose?.();
      disposedMaterials.add(material);
    }
  });
}

function buildStellatedOctahedron(size = 6, variant = 'pursuer') {
  const group = new THREE.Group();

  // 1. Generate two tetrahedron geometries and mirror one to reproduce the stellated octahedron shell.
  const primary = new THREE.TetrahedronGeometry(size * 0.8, 1); // Higher detail for sharper edges
  const mirrored = primary.clone();
  mirrored.rotateX(Math.PI);
  mirrored.rotateZ(Math.PI / 2);
  // 2. Merge both buffer geometries using the supported helper to avoid the removed Geometry.merge API.
  const merged = mergeGeometries([primary, mirrored], false);
  if (!merged) throw new Error('Failed to merge stellated octahedron geometry');
  // 3. Dispose the temporary parts.
  primary.dispose();
  mirrored.dispose();

  // Enhanced body material: Dynamic based on variant for visual distinction
  let bodyColor = 0xff5533; // Base orange-red
  let emissive = 0x220000;
  let roughness = 0.6;
  let metalness = 0.2;
  switch (variant) {
    case 'strafer':
      bodyColor = 0x00ff88; // Neon green for agile flanker
      emissive = 0x004400;
      roughness = 0.4;
      metalness = 0.4;
      break;
    case 'sentry':
      bodyColor = 0x8b0000; // Dark red for stationary turret
      emissive = 0x440000;
      roughness = 0.8;
      metalness = 0.1;
      break;
  }
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: bodyColor,
    metalness,
    roughness,
    emissive,
    emissiveIntensity: 0.3 // Pulsing glow potential
  });
  const body = new THREE.Mesh(merged, bodyMaterial);
  group.add(body);

  // Add menacing spikes: Procedural, variant-specific count and style for danger
  const spikeGeometry = new THREE.ConeGeometry(0.4, 2, 5);
  const spikeMaterial = new THREE.MeshStandardMaterial({
    color: 0x111111,
    roughness: 0.1,
    metalness: 0.95 // Razor-sharp reflection
  });
  const spikeCount = variant === 'sentry' ? 8 : variant === 'strafer' ? 12 : 6; // More for aggressive variants
  for (let i = 0; i < spikeCount; i++) {
    const angle = (i / spikeCount) * Math.PI * 2;
    const radius = size * 0.7;
    const heightOffset = (Math.random() - 0.5) * 0.5;
    const spikePos = new THREE.Vector3(
      Math.cos(angle) * radius,
      heightOffset,
      Math.sin(angle) * radius
    );
    const spike = new THREE.Mesh(spikeGeometry, spikeMaterial);
    spike.position.copy(spikePos);
    // Orient spikes radially outward
    spike.lookAt(spikePos.clone().multiplyScalar(2));
    spike.rotateX(Math.PI); // Flip to point out
    group.add(spike);

    // Secondary barbs on spikes for extra threat
    if (Math.random() > 0.3) {
      const barb = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.2, 1.5),
        spikeMaterial
      );
      barb.position.copy(spikePos.clone().add(new THREE.Vector3(0, 0, -1)));
      barb.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      group.add(barb);
    }
  }

  // Glowing core: Emissive sphere for a volatile energy heart
  const coreGeometry = new THREE.SphereGeometry(size * 0.3, 12, 8);
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    emissive: 0xff0000,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 0.8
  });
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  core.position.set(0, 0, 0);
  group.add(core);

  // Variant-specific accents
  if (variant === 'strafer') {
    // Side vents for speed implication
    const ventGeometry = new THREE.BoxGeometry(1.5, 0.3, 3);
    const ventMaterial = new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x004400 });
    const leftVent = new THREE.Mesh(ventGeometry, ventMaterial);
    leftVent.position.set(-size * 0.6, 0, 0);
    group.add(leftVent);
    const rightVent = leftVent.clone();
    rightVent.position.set(size * 0.6, 0, 0);
    group.add(rightVent);
  } else if (variant === 'sentry') {
    // Turret base for grounded feel
    const baseGeometry = new THREE.CylinderGeometry(size * 0.9, size * 1.1, 0.5, 8);
    const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.position.set(0, -size * 0.6, 0);
    group.add(base);
  }

  // Animation hook: Subtle idle rotation and pulse
  group.userData = {
    originalEmissive: bodyMaterial.emissive.clone(),
    pulseTime: 0,
    variant
  };

  return group;
}

export function createEnemy(scene: THREE.Scene, position: THREE.Vector3, options: EnemyOptions = {}) {
  // 1. Materialise the mesh, position it, and append it to the active scene graph.
  const mesh = buildStellatedOctahedron(5, options.variant);
  mesh.position.copy(position);
  scene.add(mesh);

  const vel = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const difficulty = options.difficulty ?? getDifficultyState();
  const hpBase = 40 * difficulty.enemyHpMultiplier;
  const acceleration = 18 + difficulty.enemyDpsMultiplier * 6 + (options.variant === 'strafer' ? 4 : 0);
  const maxSpeed = 36 + difficulty.enemyDpsMultiplier * 8 + (options.variant === 'strafer' ? 10 : 0);

  const obj = {
    mesh,
    hp: hpBase,
    difficulty,
    target: undefined as THREE.Object3D | undefined,
    update(dt: number) {
      // Enhanced update: Add idle animation and variant-specific behaviors
      const userData = mesh.userData;
      userData.pulseTime += dt;
      // Pulse emissive for threat
      const pulse = 0.2 + Math.sin(userData.pulseTime * 3) * 0.1;
      if (mesh.children[0]?.material) { // Body
        (mesh.children[0].material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + pulse * 0.2;
      }
      if (userData.variant === 'sentry') {
        // Sentry: Slow turret rotation only when targeting
        if (this.target) mesh.rotation.y += dt * 0.5;
      } else {
        // Others: Gentle idle spin
        mesh.rotation.y += dt * 0.01;
      }

      if (this.target) {
        dir.copy(this.target.position).sub(mesh.position);
        const distance = dir.length() || 1;
        dir.normalize();
        const aimAssist = THREE.MathUtils.lerp(0.6, 1, difficulty.enemyAccuracy);
        vel.addScaledVector(dir, acceleration * aimAssist * dt);
        applyEnvironmentVectorAttenuation(vel);
        const clamped = Math.min(maxSpeed, maxSpeed * (distance > 180 ? 1.1 : 1));
        vel.clampLength(0, clamped);
        mesh.position.addScaledVector(vel, dt);
        mesh.lookAt(this.target.position);

        // Strafer: Zigzag pattern for evasion
        if (userData.variant === 'strafer' && Math.random() < 0.02) {
          vel.add(new THREE.Vector3((Math.random() - 0.5) * 20, 0, 0));
        }
      }
    },
    onDeath() {
      scene.remove(mesh);
      disposeMeshLike(mesh);
    }
  };

  // 2. Track the enemy so the wave manager can iterate and update per frame.
  ;(scene as any).__enemies ??= [];
  ;(scene as any).__enemies.push(obj);
  return obj;
}

export function updateEnemies(scene: THREE.Scene, dt: number, difficulty: EnemyDifficultyContext) {
  // 1. Advance each tracked enemy AI using the shared scene registry.
  const arr = (scene as any).__enemies as any[] | undefined;
  if (!arr) return;
  for (const e of arr) {
    e.difficulty = difficulty;
    e.update(dt);
  }
}