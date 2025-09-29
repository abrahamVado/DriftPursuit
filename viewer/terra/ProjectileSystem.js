import { requireTHREE } from '../shared/threeSetup.js';

const THREE = requireTHREE();

function ensureVector3(input){
  if (!input) return new THREE.Vector3();
  if (input.isVector3) return input.clone();
  if (Array.isArray(input)){
    const [x = 0, y = 0, z = 0] = input;
    return new THREE.Vector3(x, y, z);
  }
  const { x = 0, y = 0, z = 0 } = input;
  return new THREE.Vector3(x, y, z);
}

export class ProjectileSystem {
  constructor({ world, onImpact } = {}){
    this.world = world;
    this.onImpact = onImpact;
    this.projectiles = [];
    this.gravity = new THREE.Vector3(0, 0, -9.81);
    this.maxLifetime = 12;
  }

  spawnProjectile({ position, velocity, radius = 0.05, mass = 0.5, userData = {} } = {}){
    if (!position || !velocity) return null;
    const projectile = {
      position: ensureVector3(position),
      velocity: ensureVector3(velocity),
      radius,
      mass,
      userData,
      age: 0,
      alive: true,
    };
    this.projectiles.push(projectile);
    return projectile;
  }

  update(dt){
    if (!this.world || this.projectiles.length === 0) return;
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1){
      const projectile = this.projectiles[i];
      if (!projectile.alive) continue;
      projectile.velocity.addScaledVector(this.gravity, dt);
      projectile.position.addScaledVector(projectile.velocity, dt);
      projectile.age += dt;
      if (projectile.age > this.maxLifetime){
        projectile.alive = false;
        this.projectiles.splice(i, 1);
        continue;
      }
      if (this._resolveGroundCollision(projectile) || this._resolveObstacleCollision(projectile)){
        this.projectiles.splice(i, 1);
      }
    }
  }

  _resolveGroundCollision(projectile){
    const height = this.world.getHeightAt(projectile.position.x, projectile.position.y);
    if (projectile.position.z - height > projectile.radius){
      return false;
    }
    const normal = this.world.getSurfaceNormalAt?.(projectile.position.x, projectile.position.y) ?? new THREE.Vector3(0, 0, 1);
    const impactPoint = projectile.position.clone();
    impactPoint.z = height;
    this._notifyImpact({ position: impactPoint, normal, projectile });
    return true;
  }

  _resolveObstacleCollision(projectile){
    const obstacles = this.world.getObstaclesNear(projectile.position.x, projectile.position.y, 80);
    if (!obstacles?.length) return false;
    const originOffset = this.world.getOriginOffset?.() ?? new THREE.Vector3();
    const projectileWorld = projectile.position.clone().add(originOffset);
    for (const obstacle of obstacles){
      if (!obstacle?.mesh) continue;
      const dx = obstacle.worldPosition.x - projectileWorld.x;
      const dy = obstacle.worldPosition.y - projectileWorld.y;
      const horizontalSq = dx * dx + dy * dy;
      const radius = obstacle.radius + projectile.radius;
      if (horizontalSq > radius * radius) continue;
      const obstacleTop = obstacle.topHeight ?? obstacle.worldPosition.z;
      const altitude = projectileWorld.z - obstacleTop;
      if (altitude > projectile.radius) continue;
      const impactPoint = obstacle.worldPosition.clone().sub(originOffset);
      impactPoint.z = obstacleTop - originOffset.z;
      this._notifyImpact({ position: impactPoint, normal: new THREE.Vector3(0, 0, 1), projectile, obstacle });
      return true;
    }
    return false;
  }

  _notifyImpact({ position, normal, projectile, obstacle }){
    if (typeof this.onImpact === 'function'){
      this.onImpact({ position, normal, obstacle, projectile });
    } else if (typeof this.world?.applyProjectileImpact === 'function'){
      this.world.applyProjectileImpact({ position, normal, obstacle });
    }
  }
}
