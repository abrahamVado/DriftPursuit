import { requireTHREE } from '../shared/threeSetup.js';

const THREE = requireTHREE();

const FORWARD_AXIS = new THREE.Vector3(0, 1, 0);
const TMP_POSITION = new THREE.Vector3();
const TMP_QUATERNION = new THREE.Quaternion();
const TMP_DIRECTION = new THREE.Vector3();
const TMP_CENTER = new THREE.Vector3();

const PROJECTILE_SPEED = 320;
const PROJECTILE_LIFESPAN = 6;
const PROJECTILE_RADIUS = 0.45;

function normalizeScale(scale){
  if (Array.isArray(scale) && scale.length >= 3){
    return { x: scale[0] ?? 1, y: scale[1] ?? 1, z: scale[2] ?? 1 };
  }
  if (typeof scale === 'object' && scale){
    return {
      x: Number.isFinite(scale.x) ? scale.x : 1,
      y: Number.isFinite(scale.y) ? scale.y : 1,
      z: Number.isFinite(scale.z) ? scale.z : 1,
    };
  }
  if (Number.isFinite(scale)){
    return { x: scale, y: scale, z: scale };
  }
  return { x: 1, y: 1, z: 1 };
}

function normalizeAmmoConfig(config = {}){
  const scale = normalizeScale(config.scale);
  const collisionRadius = Number.isFinite(config.collisionRadius)
    ? config.collisionRadius
    : PROJECTILE_RADIUS * Math.max(scale.x, scale.y, scale.z);

  return {
    id: config.id ?? 'standard',
    name: config.name ?? 'Aurora Burst',
    effect: config.effect ?? 'Balanced energy bolt',
    color: config.color ?? 0xffd25c,
    emissive: config.emissive ?? 0xff9b2f,
    emissiveIntensity: Number.isFinite(config.emissiveIntensity) ? config.emissiveIntensity : 0.95,
    metalness: Number.isFinite(config.metalness) ? config.metalness : 0.35,
    roughness: Number.isFinite(config.roughness) ? config.roughness : 0.4,
    opacity: Number.isFinite(config.opacity) ? config.opacity : 1,
    transparent: config.transparent ?? false,
    speed: Number.isFinite(config.speed) ? config.speed : PROJECTILE_SPEED,
    lifespan: Number.isFinite(config.lifespan) ? config.lifespan : PROJECTILE_LIFESPAN,
    collisionRadius,
    scale,
    stretch: Number.isFinite(config.stretch) ? config.stretch : 1,
    behavior: config.behavior ? { ...config.behavior } : null,
  };
}

const DEFAULT_AMMO_TYPES = [
  normalizeAmmoConfig({
    id: 'aurora',
    name: 'Aurora Burst',
    effect: 'Balanced energy bolt',
    color: 0xffd25c,
    emissive: 0xff9b2f,
    emissiveIntensity: 1.1,
    behavior: { type: 'pulse', amplitude: 0.28, speed: 6.2 },
  }),
  normalizeAmmoConfig({
    id: 'ion-lance',
    name: 'Ion Lance',
    effect: 'High velocity beam',
    color: 0xa0f2ff,
    emissive: 0x4fd7ff,
    emissiveIntensity: 1.45,
    speed: 420,
    lifespan: 7.5,
    scale: { x: 0.65, y: 1.6, z: 0.65 },
    collisionRadius: 0.32,
    behavior: { type: 'fade', fadeStart: 0.55, fadeDuration: 2.4 },
  }),
  normalizeAmmoConfig({
    id: 'meteor-forge',
    name: 'Meteor Forge',
    effect: 'Heavy impact slug',
    color: 0xff7b45,
    emissive: 0xff5212,
    emissiveIntensity: 1.05,
    speed: 250,
    lifespan: 5,
    scale: 1.35,
    collisionRadius: 0.62,
    behavior: { type: 'ember', flicker: 0.4, speed: 9.5, scaleAmount: 0.12 },
  }),
  normalizeAmmoConfig({
    id: 'frost-bloom',
    name: 'Frost Bloom',
    effect: 'Chilled dispersal round',
    color: 0xd6e8ff,
    emissive: 0x7fc4ff,
    emissiveIntensity: 0.85,
    speed: 280,
    lifespan: 6.8,
    scale: 1.15,
    transparent: true,
    opacity: 0.9,
    behavior: { type: 'pulse', amplitude: 0.18, speed: 3.4 },
  }),
];

export class TerraProjectileManager {
  constructor({ scene, ammoTypes = [] } = {}){
    this.scene = scene ?? null;
    this.projectiles = [];
    this.geometry = new THREE.SphereGeometry(0.36, 20, 20);
    this.ammoTypes = new Map();
    this.materialCache = new Map();
    this.currentAmmoId = null;
    this.setAmmoTypes(ammoTypes.length ? ammoTypes : DEFAULT_AMMO_TYPES);
  }

  setAmmoTypes(types = []){
    this.ammoTypes.clear();
    this.materialCache.clear();
    types.forEach((entry) => {
      const normalized = normalizeAmmoConfig(entry);
      this.ammoTypes.set(normalized.id, normalized);
    });
    if (this.ammoTypes.size === 0){
      DEFAULT_AMMO_TYPES.forEach((entry) => {
        this.ammoTypes.set(entry.id, entry);
      });
    }
    if (!this.currentAmmoId || !this.ammoTypes.has(this.currentAmmoId)){
      this.currentAmmoId = types[0]?.id ?? DEFAULT_AMMO_TYPES[0].id;
    }
    if (!this.ammoTypes.has(this.currentAmmoId)){
      const fallback = DEFAULT_AMMO_TYPES[0];
      this.ammoTypes.set(fallback.id, fallback);
      this.currentAmmoId = fallback.id;
    }
  }

  getAmmoTypes(){
    return Array.from(this.ammoTypes.values());
  }

  getCurrentAmmoId(){
    return this.currentAmmoId;
  }

  setAmmoType(id){
    if (!id || !this.ammoTypes.has(id)){
      return false;
    }
    this.currentAmmoId = id;
    return true;
  }

  setScene(scene){
    this.scene = scene ?? null;
  }

  spawnFromMuzzle(muzzle, { ownerId = null, inheritVelocity = null } = {}){
    if (!muzzle || !this.scene) return null;

    muzzle.updateMatrixWorld(true);
    muzzle.getWorldPosition(TMP_POSITION);
    muzzle.getWorldQuaternion(TMP_QUATERNION);

    const direction = TMP_DIRECTION.set(0, 1, 0).applyQuaternion(TMP_QUATERNION).normalize();
    if (direction.lengthSq() === 0){
      direction.copy(FORWARD_AXIS);
    }

    const ammo = this._getActiveAmmo();
    const material = this._createMaterial(ammo);
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.name = 'terraProjectile';
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.position.copy(TMP_POSITION);
    mesh.quaternion.setFromUnitVectors(FORWARD_AXIS, direction);
    mesh.scale.set(ammo.scale.x, ammo.scale.y * ammo.stretch, ammo.scale.z);
    this.scene.add(mesh);

    const velocity = direction.clone().multiplyScalar(ammo.speed);
    if (inheritVelocity && typeof inheritVelocity.x === 'number'){
      velocity.add(inheritVelocity);
    }

    const projectile = {
      mesh,
      velocity,
      ownerId,
      age: 0,
      lifespan: ammo.lifespan,
      ammo,
      radius: ammo.collisionRadius,
      baseScale: { x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z },
    };
    this.projectiles.push(projectile);
    return projectile;
  }

  clearByOwner(ownerId){
    if (!ownerId) return;
    const survivors = [];
    for (const projectile of this.projectiles){
      if (projectile.ownerId === ownerId){
        this._disposeProjectile(projectile);
      } else {
        survivors.push(projectile);
      }
    }
    this.projectiles = survivors;
  }

  update(dt, { vehicles = null, onVehicleHit = null } = {}){
    if (dt <= 0) return;
    const survivors = [];
    for (const projectile of this.projectiles){
      projectile.age += dt;
      if (projectile.age >= projectile.lifespan){
        this._disposeProjectile(projectile);
        continue;
      }

      projectile.mesh.position.addScaledVector(projectile.velocity, dt);
      this._applyProjectileBehavior(projectile, dt);

      if (vehicles){
        const hitVehicle = this._findVehicleHit(projectile, vehicles);
        if (hitVehicle){
          if (typeof onVehicleHit === 'function'){
            onVehicleHit(hitVehicle, projectile);
          }
          this._disposeProjectile(projectile);
          continue;
        }
      }

      survivors.push(projectile);
    }
    this.projectiles = survivors;
  }

  _findVehicleHit(projectile, vehicles){
    const projectilePosition = projectile.mesh.position;
    for (const vehicle of vehicles.values()){
      if (!vehicle) continue;
      if (vehicle.id === projectile.ownerId) continue;
      const carMode = vehicle.modes?.car;
      const carMesh = carMode?.rig?.carMesh ?? null;
      if (!carMesh || !carMesh.visible) continue;
      const localCenter = carMesh.userData?.boundingCenter;
      const radius = carMesh.userData?.boundingRadius;
      if (!localCenter || !Number.isFinite(radius)) continue;
      TMP_CENTER.copy(localCenter);
      carMesh.localToWorld(TMP_CENTER);
      const totalRadius = radius + (projectile.radius ?? PROJECTILE_RADIUS);
      if (TMP_CENTER.distanceToSquared(projectilePosition) <= totalRadius * totalRadius){
        return vehicle;
      }
    }
    return null;
  }

  _disposeProjectile(projectile){
    if (projectile.mesh && this.scene){
      this.scene.remove(projectile.mesh);
      if (projectile.mesh.material){
        projectile.mesh.material.dispose();
      }
    }
  }

  _getActiveAmmo(){
    if (this.currentAmmoId && this.ammoTypes.has(this.currentAmmoId)){
      return this.ammoTypes.get(this.currentAmmoId);
    }
    const first = this.ammoTypes.values().next().value;
    if (first) return first;
    const fallback = DEFAULT_AMMO_TYPES[0];
    this.ammoTypes.set(fallback.id, fallback);
    this.currentAmmoId = fallback.id;
    return fallback;
  }

  _createMaterial(ammo){
    const key = ammo?.id ?? 'default';
    const cached = this.materialCache.get(key);
    const baseMaterial = cached ?? new THREE.MeshStandardMaterial({
      color: ammo.color,
      emissive: ammo.emissive,
      emissiveIntensity: ammo.emissiveIntensity,
      metalness: ammo.metalness,
      roughness: ammo.roughness,
      transparent: ammo.transparent || ammo.opacity < 1,
      opacity: ammo.opacity,
    });
    if (!cached){
      this.materialCache.set(key, baseMaterial);
    }
    const material = baseMaterial.clone();
    material.emissiveIntensity = ammo.emissiveIntensity;
    material.opacity = ammo.opacity;
    material.transparent = ammo.transparent || ammo.opacity < 1;
    return material;
  }

  _applyProjectileBehavior(projectile, dt){
    const behavior = projectile.ammo?.behavior;
    if (!behavior) return;
    const material = projectile.mesh.material;
    if (!material) return;
    switch (behavior.type){
      case 'pulse': {
        const amplitude = Number.isFinite(behavior.amplitude) ? behavior.amplitude : 0.2;
        const speed = Number.isFinite(behavior.speed) ? behavior.speed : 5;
        const base = projectile.ammo.emissiveIntensity ?? 1;
        const pulse = base + Math.sin(projectile.age * speed) * amplitude;
        material.emissiveIntensity = Math.max(0, pulse);
        break;
      }
      case 'fade': {
        const fadeStart = Number.isFinite(behavior.fadeStart) ? behavior.fadeStart : 0.5;
        const fadeDuration = Number.isFinite(behavior.fadeDuration) ? behavior.fadeDuration : 2;
        const startTime = projectile.lifespan * Math.max(0, Math.min(1, fadeStart));
        const elapsed = Math.max(0, projectile.age - startTime);
        if (elapsed > 0){
          const t = Math.min(1, elapsed / Math.max(0.0001, fadeDuration));
          material.transparent = true;
          material.opacity = Math.max(0.05, 1 - t);
        }
        break;
      }
      case 'ember': {
        const flicker = Number.isFinite(behavior.flicker) ? behavior.flicker : 0.35;
        const speed = Number.isFinite(behavior.speed) ? behavior.speed : 8;
        const scaleAmount = Number.isFinite(behavior.scaleAmount) ? behavior.scaleAmount : 0.08;
        const emissive = projectile.ammo.emissiveIntensity ?? 1;
        material.emissiveIntensity = Math.max(0, emissive * (1 + Math.sin(projectile.age * speed) * flicker));
        const scaleJitter = 1 + Math.sin(projectile.age * (speed * 0.6)) * scaleAmount;
        projectile.mesh.scale.set(
          projectile.baseScale.x * scaleJitter,
          projectile.baseScale.y,
          projectile.baseScale.z * scaleJitter,
        );
        break;
      }
      default:
        break;
    }
  }
}
