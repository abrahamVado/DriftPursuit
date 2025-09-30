import { requireTHREE } from '../shared/threeSetup.js';

const THREE = requireTHREE();

if (!THREE) throw new Error('ProjectileSystem requires THREE to be available');

const FORWARD = new THREE.Vector3(0, 1, 0);
const TMP_QUAT = new THREE.Quaternion();

export class ProjectileSystem {
  constructor({ scene, world } = {}){
    if (!scene) throw new Error('ProjectileSystem requires a scene reference');
    this.scene = scene;
    this.world = world ?? null;

    this.projectiles = [];
    this.explosions = [];

    this.cooldown = 0;
    this.cooldownDuration = 0.65;
    this.maxLife = 14;
    this.missileSpeed = 420;
    this.craterRadius = 480;
    this.craterDepth = 320;
    this.craterRimHeight = 120;
    this.planetExplosionScale = 34;
    this.spaceExplosionScale = 18;

    this.shared = this._createSharedAssets();
  }

  setWorld(world){
    this.world = world;
  }

  tryFire({ position, orientation, velocity } = {}){
    if (this.cooldown > 0) return false;
    if (!position || !orientation) return false;

    this.cooldown = this.cooldownDuration;
    const spawnPos = position.clone();
    const direction = FORWARD.clone().applyQuaternion(orientation).normalize();
    spawnPos.addScaledVector(direction, 8);
    spawnPos.addScaledVector(new THREE.Vector3(0, 0, -0.8), 1);

    const velocityVector = direction.clone().multiplyScalar(this.missileSpeed);
    if (velocity) velocityVector.add(velocity.clone());

    const group = new THREE.Group();
    group.name = 'TorpedoProjectile';

    const body = new THREE.Mesh(this.shared.bodyGeometry.clone(), this.shared.bodyMaterial.clone());
    body.castShadow = true;
    body.receiveShadow = false;
    group.add(body);

    const nose = new THREE.Mesh(this.shared.noseGeometry.clone(), this.shared.noseMaterial.clone());
    nose.position.set(0, 1.3, 0);
    group.add(nose);

    const glow = new THREE.Mesh(this.shared.glowGeometry.clone(), this.shared.glowMaterial.clone());
    glow.position.set(0, -1.1, 0);
    group.add(glow);

    this.scene.add(group);

    const projectile = {
      mesh: group,
      position: spawnPos,
      velocity: velocityVector,
      direction,
      life: 0,
      maxLife: this.maxLife,
    };
    this._alignMesh(projectile);
    this.projectiles.push(projectile);
    return true;
  }

  update(dt, { scenario = 'planet', originOffset = null, spaceBodies = [] } = {}){
    const delta = Math.max(0, dt ?? 0);
    this.cooldown = Math.max(0, this.cooldown - delta);

    const origin = originOffset ?? new THREE.Vector3();

    for (let i = this.projectiles.length - 1; i >= 0; i -= 1){
      const projectile = this.projectiles[i];
      projectile.life += delta;
      if (projectile.life > projectile.maxLife){
        this._disposeProjectileIndex(i);
        continue;
      }

      projectile.position.addScaledVector(projectile.velocity, delta);
      this._alignMesh(projectile);

      let impacted = false;

      if (scenario === 'planet' && this.world){
        const ground = this.world.getHeightAt(projectile.position.x, projectile.position.y);
        if (Number.isFinite(ground) && projectile.position.z <= ground + 2){
          const impactPos = projectile.position.clone();
          impactPos.z = ground;
          const speed = projectile.velocity.length();
          const speedScale = THREE.MathUtils.clamp(speed / this.missileSpeed, 0.6, 1.9);
          this._spawnExplosion(impactPos, this.planetExplosionScale * speedScale, 1.2);
          const worldX = impactPos.x + origin.x;
          const worldY = impactPos.y + origin.y;
          const radius = this.craterRadius * speedScale;
          const depth = this.craterDepth * (0.85 + 0.15 * speedScale);
          const rimHeight = this.craterRimHeight * (0.75 + 0.25 * speedScale);
          this.world.addDynamicCrater?.({ worldX, worldY, radius, depth, rimHeight });
          this._disposeProjectileIndex(i);
          impacted = true;
        }
      }

      if (!impacted && scenario === 'space' && Array.isArray(spaceBodies)){
        for (let b = 0; b < spaceBodies.length; b += 1){
          const body = spaceBodies[b];
          const radius = body?.radius ?? 0;
          if (radius <= 0) continue;
          const pos = body.position ?? body.mesh?.position;
          if (!pos) continue;
          const distance = projectile.position.distanceTo(pos);
          if (distance <= radius){
            const impactPos = projectile.position.clone();
            this._spawnExplosion(impactPos, this.spaceExplosionScale, 0.8);
            this._disposeProjectileIndex(i);
            impacted = true;
            break;
          }
        }
      }

      if (impacted) continue;

      const distance = projectile.position.length();
      if (distance > 120000){
        this._disposeProjectileIndex(i);
      }
    }

    for (let e = this.explosions.length - 1; e >= 0; e -= 1){
      const explosion = this.explosions[e];
      explosion.life += delta;
      const t = explosion.life / explosion.duration;
      if (t >= 1){
        this.scene.remove(explosion.mesh);
        explosion.mesh.traverse((obj) => {
          if (obj.material?.dispose) obj.material.dispose();
          if (obj.geometry?.dispose) obj.geometry.dispose();
        });
        this.explosions.splice(e, 1);
        continue;
      }
      const lerpT = Math.pow(t, 0.6);
      const baseScale = explosion.initialScale ?? 1;
      const targetScale = Math.max(baseScale, explosion.scaleTarget ?? baseScale);
      const scale = THREE.MathUtils.lerp(baseScale, targetScale, lerpT);
      const baseScaleZ = explosion.initialZScale ?? baseScale * 0.6;
      const targetScaleZ = Math.max(baseScaleZ, targetScale * 0.5);
      const scaleZ = THREE.MathUtils.lerp(baseScaleZ, targetScaleZ, lerpT);
      explosion.mesh.scale.set(scale, scale, scaleZ);
      const mat = explosion.material;
      if (mat){
        mat.opacity = THREE.MathUtils.lerp(explosion.startOpacity, 0, t * t);
        mat.needsUpdate = true;
      }
    }
  }

  handleOriginShift(shift){
    if (!shift) return;
    this.projectiles.forEach((projectile) => {
      projectile.position.sub(shift);
      this._alignMesh(projectile);
    });
    this.explosions.forEach((explosion) => {
      explosion.mesh.position.sub(shift);
    });
  }

  _createSharedAssets(){
    const bodyGeometry = new THREE.CylinderGeometry(0.25, 0.32, 2.6, 16, 1, true);
    bodyGeometry.rotateZ(Math.PI / 2);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xd5daf0, metalness: 0.6, roughness: 0.32, emissive: 0x101424, emissiveIntensity: 0.2 });

    const noseGeometry = new THREE.ConeGeometry(0.32, 0.9, 16);
    noseGeometry.rotateZ(Math.PI / 2);
    const noseMaterial = new THREE.MeshStandardMaterial({ color: 0xff9c73, metalness: 0.4, roughness: 0.26, emissive: 0x331a11, emissiveIntensity: 0.3 });

    const glowGeometry = new THREE.ConeGeometry(0.42, 1.8, 12, 1, true);
    glowGeometry.rotateZ(-Math.PI / 2);
    const glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffe0a8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });

    const explosionGeometry = new THREE.SphereGeometry(1, 24, 24);

    return {
      bodyGeometry,
      bodyMaterial,
      noseGeometry,
      noseMaterial,
      glowGeometry,
      glowMaterial,
      explosionGeometry,
    };
  }

  _spawnExplosion(position, targetScale = 24, opacityScale = 1){
    const material = new THREE.MeshBasicMaterial({
      color: 0xffc893,
      transparent: true,
      opacity: THREE.MathUtils.clamp(0.9 * opacityScale, 0.15, 1.4),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(this.shared.explosionGeometry.clone(), material);
    mesh.position.copy(position);
    const initialScale = Math.max(1.2, targetScale * 0.12);
    mesh.scale.set(initialScale, initialScale, initialScale * 0.6);
    const resolvedTargetScale = Math.max(initialScale * 1.4, targetScale);
    mesh.name = 'MissileExplosion';
    this.scene.add(mesh);
    this.explosions.push({
      mesh,
      material,
      life: 0,
      duration: 1.6,
      scaleTarget: resolvedTargetScale,
      startOpacity: material.opacity,
      initialScale,
      initialZScale: initialScale * 0.6,
    });
  }

  _alignMesh(projectile){
    if (!projectile.mesh) return;
    projectile.mesh.position.copy(projectile.position);
    const direction = projectile.velocity.clone().normalize();
    TMP_QUAT.setFromUnitVectors(FORWARD, direction);
    projectile.mesh.quaternion.copy(TMP_QUAT);
  }

  _disposeProjectileIndex(index){
    const projectile = this.projectiles[index];
    if (!projectile) return;
    if (projectile.mesh){
      this.scene.remove(projectile.mesh);
      projectile.mesh.traverse((obj) => {
        if (obj.material?.dispose) obj.material.dispose();
        if (obj.geometry?.dispose) obj.geometry.dispose();
      });
    }
    this.projectiles.splice(index, 1);
  }
}
