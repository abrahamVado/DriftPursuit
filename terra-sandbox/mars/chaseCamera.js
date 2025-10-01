import { THREE } from './threeLoader.js';

const FORWARD = new THREE.Vector3(0, 1, 0);
const UP = new THREE.Vector3(0, 0, 1);

export class MarsChaseCamera {
  constructor({
    camera,
    distance = 48,
    height = 16,
    lookAhead = 22,
    responsiveness = 6,
    rollFollow = true,
    rollResponsiveness = 4.2,
  } = {}) {
    this.camera = camera;
    this.distance = distance;
    this.height = height;
    this.lookAhead = lookAhead;
    this.responsiveness = responsiveness;
    this.rollFollow = rollFollow;
    this.rollResponsiveness = rollResponsiveness;
    this.target = null;
    this._position = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();
    this._cameraUp = new THREE.Vector3(0, 0, 1);
  }

  follow(target) {
    this.target = target;
    if (target) {
      this.snap();
    }
  }

  update(dt) {
    if (!this.target) return;
    const blend = dt > 0 ? 1 - Math.exp(-this.responsiveness * dt) : 1;
    const rollBlend = dt > 0 ? 1 - Math.exp(-this.rollResponsiveness * dt) : 1;

    const forward = FORWARD.clone().applyQuaternion(this.target.orientation ?? this.target.quaternion);
    const up = UP.clone().applyQuaternion(this.target.orientation ?? this.target.quaternion);

    this._desired.copy(this.target.position)
      .addScaledVector(forward, -this.distance)
      .addScaledVector(up, this.height);

    if (this._position.lengthSq() === 0) {
      this._position.copy(this._desired);
    } else {
      this._position.lerp(this._desired, blend);
    }

    this.camera.position.copy(this._position);

    if (this.rollFollow) {
      if (this._cameraUp.lengthSq() === 0) {
        this._cameraUp.copy(up);
      } else {
        this._cameraUp.lerp(up, rollBlend);
      }
      this.camera.up.copy(this._cameraUp).normalize();
    } else {
      this.camera.up.set(0, 0, 1);
    }

    this._lookTarget.copy(this.target.position).addScaledVector(forward, this.lookAhead);
    this.camera.lookAt(this._lookTarget);
  }

  snap() {
    if (!this.target) return;
    const forward = FORWARD.clone().applyQuaternion(this.target.orientation ?? this.target.quaternion);
    const up = UP.clone().applyQuaternion(this.target.orientation ?? this.target.quaternion);
    this._position.copy(this.target.position)
      .addScaledVector(forward, -this.distance)
      .addScaledVector(up, this.height);
    this.camera.position.copy(this._position);
    if (this.rollFollow) {
      this._cameraUp.copy(up);
      this.camera.up.copy(this._cameraUp).normalize();
    } else {
      this.camera.up.set(0, 0, 1);
    }
    this._lookTarget.copy(this.target.position).addScaledVector(forward, this.lookAhead);
    this.camera.lookAt(this._lookTarget);
  }
}
