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

export class TerraProjectileManager {
  constructor({ scene } = {}){
    this.scene = scene ?? null;
    this.projectiles = [];
    this.geometry = new THREE.SphereGeometry(0.36, 12, 12);
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffd25c,
      emissive: 0xff9b2f,
      emissiveIntensity: 0.85,
      metalness: 0.25,
      roughness: 0.35,
    });
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

    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.name = 'terraProjectile';
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.position.copy(TMP_POSITION);
    mesh.quaternion.setFromUnitVectors(FORWARD_AXIS, direction);
    this.scene.add(mesh);

    const velocity = direction.clone().multiplyScalar(PROJECTILE_SPEED);
    if (inheritVelocity && typeof inheritVelocity.x === 'number'){
      velocity.add(inheritVelocity);
    }

    const projectile = {
      mesh,
      velocity,
      ownerId,
      age: 0,
      lifespan: PROJECTILE_LIFESPAN,
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
      const totalRadius = radius + PROJECTILE_RADIUS;
      if (TMP_CENTER.distanceToSquared(projectilePosition) <= totalRadius * totalRadius){
        return vehicle;
      }
    }
    return null;
  }

  _disposeProjectile(projectile){
    if (projectile.mesh && this.scene){
      this.scene.remove(projectile.mesh);
    }
  }
}
