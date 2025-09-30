import { requireTHREE } from '../shared/threeSetup.js';

const THREE = requireTHREE();

const FORWARD_AXIS = new THREE.Vector3(0, 1, 0);
const TMP_POSITION = new THREE.Vector3();
const TMP_QUATERNION = new THREE.Quaternion();
const TMP_DIRECTION = new THREE.Vector3();
const TMP_CENTER = new THREE.Vector3();
const TMP_IMPACT_POSITION = new THREE.Vector3();
const TMP_ORIGIN_OFFSET = new THREE.Vector3();
const TMP_NORMAL = new THREE.Vector3(0, 0, 1);
const LAMP_BEHAVIOR_TYPE = 'lamp';

const PROJECTILE_SPEED = 320;
const PROJECTILE_LIFESPAN = 6;
const PROJECTILE_RADIUS = 0.45;

const DEFAULT_EXPLOSION = {
  color: 0xffc677,
  duration: 1.1,
  maxScale: 6,
  startScale: 0.6,
  fadePower: 1.6,
};

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

function normalizeExplosionConfig(config){
  if (!config) return null;
  return {
    color: config.color ?? DEFAULT_EXPLOSION.color,
    duration: Number.isFinite(config.duration) ? config.duration : DEFAULT_EXPLOSION.duration,
    maxScale: Number.isFinite(config.scale) ? config.scale : DEFAULT_EXPLOSION.maxScale,
    startScale: Number.isFinite(config.startScale) ? config.startScale : DEFAULT_EXPLOSION.startScale,
    fadePower: Number.isFinite(config.fadePower) ? config.fadePower : DEFAULT_EXPLOSION.fadePower,
  };
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
    explosion: normalizeExplosionConfig(config.explosion),
  };
}

const DEFAULT_AMMO_TYPES = [
  normalizeAmmoConfig({
    id: 'laser-beam',
    name: 'Laser Beam',
    effect: 'Rapid precision beam',
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
    id: 'rocket-launcher',
    name: 'Rocket Launcher',
    effect: 'Explosive payload rocket',
    color: 0xfff2b3,
    emissive: 0xffd45a,
    emissiveIntensity: 1.35,
    speed: 260,
    lifespan: 5.5,
    scale: 1.5,
    collisionRadius: 0.7,
    behavior: { type: 'ember', flicker: 0.55, speed: 7.8, scaleAmount: 0.18 },
    explosion: { color: 0xffef90, duration: 1.35, scale: 8.5, startScale: 0.8, fadePower: 1.4 },
  }),
  normalizeAmmoConfig({
    id: 'lumen-lamp',
    name: 'Lumen Lamp',
    effect: 'Turret-mounted illumination beam',
    color: 0xfff6d0,
    emissive: 0xfff0a2,
    emissiveIntensity: 0.45,
    speed: 0,
    lifespan: 0,
    stretch: 0.4,
    scale: { x: 0.8, y: 0.8, z: 0.8 },
    behavior: {
      type: 'lamp',
      intensity: 3.4,
      distance: 520,
      angle: THREE.MathUtils.degToRad(36),
      penumbra: 0.42,
      decay: 1.2,
      color: 0xfff3c4,
      targetDistance: 52,
      castShadow: false,
    },
    explosion: null,
  }),
];

export class TerraProjectileManager {
  constructor({ scene, world = null, ammoTypes = [] } = {}){
    this.scene = scene ?? null;
    this.world = world ?? null;
    this.projectiles = [];
    this.geometry = new THREE.SphereGeometry(0.36, 20, 20);
    this.ammoTypes = new Map();
    this.materialCache = new Map();
    this.currentAmmoId = null;
    this.explosions = [];
    this.explosionGeometry = new THREE.SphereGeometry(1, 18, 18);
    this.setAmmoTypes(ammoTypes.length ? ammoTypes : DEFAULT_AMMO_TYPES);
    this.lamp = {
      light: null,
      target: null,
      muzzle: null,
      ownerId: null,
      behavior: null,
    };
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

    if (!this.isLampAmmoActive()){
      this.clearLampTarget();
    }
  }

  getAmmoTypes(){
    return Array.from(this.ammoTypes.values());
  }

  getCurrentAmmoId(){
    return this.currentAmmoId;
  }

  isLampAmmoActive(){
    const ammo = this._getActiveAmmo();
    return this._isLampAmmo(ammo);
  }

  setAmmoType(id){
    if (!id || !this.ammoTypes.has(id)){
      return false;
    }
    this.currentAmmoId = id;
    if (!this.isLampAmmoActive()){
      this.clearLampTarget();
    }
    return true;
  }

  setScene(scene){
    if (this.scene && this.scene !== scene){
      this._clearExplosions();
    }
    if (this.lamp.light && this.scene && this.scene !== scene){
      this.scene.remove(this.lamp.light);
      if (this.lamp.target){
        this.scene.remove(this.lamp.target);
      }
    }
    this.scene = scene ?? null;
    if (!this.scene){
      this.clearLampTarget();
    } else if (this.lamp.light){
      this.scene.add(this.lamp.light);
      if (this.lamp.target){
        this.scene.add(this.lamp.target);
      }
    }
  }

  setWorld(world){
    this.world = world ?? null;
  }

  syncLampTarget(muzzle, { ownerId = null } = {}){
    const ammo = this._getActiveAmmo();
    if (!this._isLampAmmo(ammo)){
      this.clearLampTarget();
      return;
    }
    if (!muzzle || !this.scene){
      this.clearLampTarget();
      return;
    }

    muzzle.updateMatrixWorld?.(true);

    if (!this.lamp.light){
      const behavior = ammo.behavior ?? {};
      const light = new THREE.SpotLight(
        behavior.color ?? 0xfff0c0,
        behavior.intensity ?? 3.2,
        behavior.distance ?? 480,
        behavior.angle ?? THREE.MathUtils.degToRad(36),
        behavior.penumbra ?? 0.4,
        behavior.decay ?? 1,
      );
      light.castShadow = !!behavior.castShadow;
      const target = new THREE.Object3D();
      this.scene.add(light);
      this.scene.add(target);
      light.target = target;
      this.lamp.light = light;
      this.lamp.target = target;
    }

    const behavior = ammo.behavior ?? {};
    this.lamp.behavior = behavior;
    this.lamp.muzzle = muzzle;
    this.lamp.ownerId = ownerId;

    const { light } = this.lamp;
    light.color.set(behavior.color ?? 0xfff0c0);
    light.intensity = behavior.intensity ?? 3.2;
    light.distance = behavior.distance ?? 480;
    light.angle = behavior.angle ?? THREE.MathUtils.degToRad(36);
    light.penumbra = behavior.penumbra ?? 0.4;
    light.decay = behavior.decay ?? 1;

    this._updateLampTransform();
  }

  clearLampTarget(){
    if (this.lamp.light){
      if (this.scene){
        this.scene.remove(this.lamp.light);
      }
      if (typeof this.lamp.light.dispose === 'function'){
        this.lamp.light.dispose();
      }
    }
    if (this.lamp.target && this.scene){
      this.scene.remove(this.lamp.target);
    }
    this.lamp.light = null;
    this.lamp.target = null;
    this.lamp.muzzle = null;
    this.lamp.ownerId = null;
    this.lamp.behavior = null;
  }

  spawnFromMuzzle(muzzle, { ownerId = null, inheritVelocity = null } = {}){
    if (!muzzle || !this.scene) return null;

    const ammo = this._getActiveAmmo();
    if (this._isLampAmmo(ammo)){
      this.syncLampTarget(muzzle, { ownerId });
      return null;
    }

    muzzle.updateMatrixWorld(true);
    muzzle.getWorldPosition(TMP_POSITION);
    muzzle.getWorldQuaternion(TMP_QUATERNION);

    const direction = TMP_DIRECTION.set(0, 1, 0).applyQuaternion(TMP_QUATERNION).normalize();
    if (direction.lengthSq() === 0){
      direction.copy(FORWARD_AXIS);
    }

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

  update(dt, { vehicles = null, onVehicleHit = null, onImpact = null } = {}){
    if (dt <= 0) return;
    this._updateLampTransform();
    const survivors = [];
    for (const projectile of this.projectiles){
      projectile.age += dt;
      if (projectile.age >= projectile.lifespan){
        this._disposeProjectile(projectile);
        continue;
      }

      projectile.mesh.position.addScaledVector(projectile.velocity, dt);
      this._applyProjectileBehavior(projectile, dt);

      let impacted = false;
      if (vehicles){
        const hitVehicle = this._findVehicleHit(projectile, vehicles);
        if (hitVehicle){
          if (typeof onVehicleHit === 'function'){
            onVehicleHit(hitVehicle, projectile);
          }
          this._disposeProjectile(projectile);
          impacted = true;
        }
      }

      if (!impacted && this.world){
        impacted = this._handleEnvironmentCollision(projectile, { onImpact });
        if (impacted){
          this._disposeProjectile(projectile);
        }
      }

      if (impacted){
        continue;
      }

      survivors.push(projectile);
    }
    this.projectiles = survivors;

    this._updateExplosions(dt);
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

  triggerExplosion({ position, ammoId = null } = {}){
    if (!position) return;
    const ammo = ammoId && this.ammoTypes.has(ammoId)
      ? this.ammoTypes.get(ammoId)
      : (this.currentAmmoId && this.ammoTypes.get(this.currentAmmoId)) ?? null;
    this._spawnExplosion({ position, ammo });
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

  _isLampAmmo(ammo){
    return !!ammo && ammo.behavior?.type === LAMP_BEHAVIOR_TYPE;
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

  _handleEnvironmentCollision(projectile, { onImpact } = {}){
    const position = projectile.mesh.position;
    if (!position || !this.world) return false;

    const originOffset = typeof this.world.getOriginOffset === 'function'
      ? this.world.getOriginOffset()
      : TMP_ORIGIN_OFFSET.set(0, 0, 0);

    const height = this.world.getHeightAt(position.x, position.y);
    if (Number.isFinite(height) && position.z <= height + (projectile.radius ?? PROJECTILE_RADIUS)){
      const impactPosition = TMP_IMPACT_POSITION.set(position.x, position.y, height);
      const normal = typeof this.world.getSurfaceNormalAt === 'function'
        ? this.world.getSurfaceNormalAt(position.x, position.y)
        : TMP_NORMAL.set(0, 0, 1);
      this._notifyImpact({ position: impactPosition.clone(), normal: normal.clone(), projectile }, onImpact);
      return true;
    }

    const obstacles = typeof this.world.getObstaclesNear === 'function'
      ? this.world.getObstaclesNear(position.x, position.y, 40)
      : null;
    if (!obstacles?.length) return false;

    const projectileWorld = TMP_IMPACT_POSITION.set(
      position.x + originOffset.x,
      position.y + originOffset.y,
      position.z + originOffset.z,
    );

    for (const obstacle of obstacles){
      if (!obstacle?.worldPosition) continue;
      const dx = obstacle.worldPosition.x - projectileWorld.x;
      const dy = obstacle.worldPosition.y - projectileWorld.y;
      const radius = (obstacle.radius ?? 3) + (projectile.radius ?? PROJECTILE_RADIUS);
      if (dx * dx + dy * dy > radius * radius) continue;
      const topHeight = obstacle.topHeight ?? obstacle.worldPosition.z;
      if (projectileWorld.z - topHeight > (projectile.radius ?? PROJECTILE_RADIUS) + 0.1) continue;
      const impactPosition = TMP_IMPACT_POSITION.set(
        obstacle.worldPosition.x - originOffset.x,
        obstacle.worldPosition.y - originOffset.y,
        topHeight - originOffset.z,
      );
      this._notifyImpact({ position: impactPosition.clone(), normal: TMP_NORMAL.set(0, 0, 1).clone(), projectile, obstacle }, onImpact);
      return true;
    }

    return false;
  }

  _notifyImpact(impact, onImpact){
    if (!impact) return;
    const projectileRadius = impact.projectile?.radius ?? PROJECTILE_RADIUS;
    const craterRadius = Math.max(0.05, projectileRadius);
    const craterDepth = Math.max(0.025, craterRadius * 0.5);
    const payload = {
      position: impact.position,
      normal: impact.normal ?? TMP_NORMAL.set(0, 0, 1),
      obstacle: impact.obstacle ?? null,
      radius: craterRadius,
      depth: craterDepth,
    };
    this._spawnExplosion({ position: impact.position, ammo: impact.projectile?.ammo ?? null });

    if (typeof onImpact === 'function'){
      onImpact(payload);
    } else if (typeof this.world?.applyProjectileImpact === 'function'){
      this.world.applyProjectileImpact(payload);
    }
  }

  _spawnExplosion({ position, ammo }){
    if (!this.scene || !position) return;
    const config = ammo?.explosion ?? DEFAULT_EXPLOSION;
    const material = new THREE.MeshBasicMaterial({
      color: config.color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.explosionGeometry, material);
    mesh.position.copy(position);
    mesh.scale.setScalar(Math.max(0.01, config.startScale ?? DEFAULT_EXPLOSION.startScale));
    mesh.renderOrder = 10;
    this.scene.add(mesh);
    this.explosions.push({
      mesh,
      material,
      age: 0,
      duration: Math.max(0.2, config.duration ?? DEFAULT_EXPLOSION.duration),
      maxScale: Math.max(0.5, config.maxScale ?? DEFAULT_EXPLOSION.maxScale),
      startScale: Math.max(0.01, config.startScale ?? DEFAULT_EXPLOSION.startScale),
      fadePower: Math.max(0.5, config.fadePower ?? DEFAULT_EXPLOSION.fadePower),
    });
  }

  _updateLampTransform(){
    const { light, target, muzzle, behavior } = this.lamp;
    if (!light || !target || !muzzle){
      return;
    }
    muzzle.updateMatrixWorld?.(true);
    muzzle.getWorldPosition(TMP_POSITION);
    muzzle.getWorldQuaternion(TMP_QUATERNION);
    light.position.copy(TMP_POSITION);
    const distance = behavior?.targetDistance ?? 48;
    const direction = TMP_DIRECTION.set(0, 1, 0).applyQuaternion(TMP_QUATERNION).normalize();
    target.position.copy(TMP_POSITION).addScaledVector(direction, distance);
  }

  _updateExplosions(dt){
    if (this.explosions.length === 0) return;
    for (let i = this.explosions.length - 1; i >= 0; i -= 1){
      const explosion = this.explosions[i];
      explosion.age += dt;
      const tRaw = explosion.age / explosion.duration;
      if (tRaw >= 1){
        this._disposeExplosionAt(i);
        continue;
      }
      const t = Math.max(0, Math.min(1, tRaw));
      const eased = 1 - Math.pow(1 - t, 3);
      const scale = explosion.startScale + (explosion.maxScale - explosion.startScale) * eased;
      explosion.mesh.scale.setScalar(scale);
      const opacity = Math.max(0, 1 - Math.pow(t, explosion.fadePower));
      explosion.material.opacity = opacity;
    }
  }

  _disposeExplosionAt(index){
    const explosion = this.explosions[index];
    if (!explosion) return;
    if (explosion.mesh && this.scene){
      this.scene.remove(explosion.mesh);
    }
    explosion.material?.dispose?.();
    this.explosions.splice(index, 1);
  }

  _clearExplosions(){
    for (let i = this.explosions.length - 1; i >= 0; i -= 1){
      this._disposeExplosionAt(i);
    }
    this.explosions = [];
  }
}
