import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.module.js';

const TMP_FORWARD = new THREE.Vector3();
const TMP_UP = new THREE.Vector3(0, 0, 1);
const TMP_TARGET = new THREE.Vector3();

export class ChaseCamera {
  constructor(camera, { distance = 55, height = 24, stiffness = 4, lookAhead = 14 } = {}){
    this.camera = camera;
    this.distance = distance;
    this.height = height;
    this.stiffness = stiffness;
    this.lookAhead = lookAhead;
    this.currentPosition = camera.position.clone();
  }

  update({ position, orientation, velocity }, dt){
    if (!this.camera || !position || !orientation) return;
    const forward = TMP_FORWARD.set(0, 1, 0).applyQuaternion(orientation).normalize();
    const desired = TMP_TARGET.copy(position)
      .addScaledVector(forward, -this.distance)
      .addScaledVector(TMP_UP, this.height);

    const lerpFactor = 1 - Math.exp(-this.stiffness * dt);
    if (Number.isFinite(lerpFactor)){
      this.currentPosition.lerp(desired, lerpFactor);
    } else {
      this.currentPosition.copy(desired);
    }

    this.camera.position.copy(this.currentPosition);

    const lookTarget = TMP_TARGET.copy(position);
    if (velocity){
      const speed = velocity.length();
      if (speed > 0.1){
        lookTarget.addScaledVector(forward, this.lookAhead + Math.min(speed * 0.2, 30));
      }
    }
    this.camera.lookAt(lookTarget);
  }
}
