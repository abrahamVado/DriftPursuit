import { THREE } from './threeLoader.js';

const FORWARD = new THREE.Vector3(0, 1, 0);

export class MarsProjectileSystem {
  constructor({ scene }) {
    this.scene = scene;
    this.projectiles = [];
    this.pool = [];
  }

  _acquireMesh(color) {
    if (this.pool.length > 0) {
      const mesh = this.pool.pop();
      if (mesh.material.emissive) {
        mesh.material.emissive.set(color);
      }
      mesh.visible = true;
      return mesh;
    }
    const geometry = new THREE.CylinderGeometry(0.4, 0.6, 3.6, 8, 1);
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 2.4,
      roughness: 0.3,
      metalness: 0.1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    geometry.rotateX(Math.PI / 2);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = 'marsProjectile';
    return mesh;
  }

  fire({ origin, direction, speed = 720, velocity = null, life = 3.5, color = new THREE.Color('#ff9d5c') }) {
    if (!origin || !direction) return;
    const mesh = this._acquireMesh(color);
    mesh.position.copy(origin);
    const look = new THREE.Quaternion().setFromUnitVectors(FORWARD, direction.clone().normalize());
    mesh.quaternion.copy(look);
    if (!mesh.parent && this.scene) {
      this.scene.add(mesh);
    }
    this.projectiles.push({
      mesh,
      velocity: velocity ? velocity.clone() : direction.clone().setLength(speed),
      life,
    });
  }

  update(dt) {
    if (this.projectiles.length === 0) return;
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = this.projectiles[i];
      projectile.life -= dt;
      if (projectile.life <= 0) {
        this._recycle(i);
        continue;
      }
      projectile.mesh.position.addScaledVector(projectile.velocity, dt);
    }
  }

  _recycle(index) {
    const projectile = this.projectiles[index];
    if (!projectile) return;
    if (projectile.mesh) {
      projectile.mesh.visible = false;
      projectile.mesh.position.set(0, -9999, 0);
      this.pool.push(projectile.mesh);
    }
    this.projectiles.splice(index, 1);
  }

  dispose() {
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      this._recycle(i);
    }
    while (this.pool.length > 0) {
      const mesh = this.pool.pop();
      mesh.geometry?.dispose?.();
      mesh.material?.dispose?.();
    }
  }
}
