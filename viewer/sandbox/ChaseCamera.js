const THREE = (typeof window !== 'undefined' ? window.THREE : globalThis?.THREE) ?? null;
if (!THREE) throw new Error('Sandbox ChaseCamera requires THREE to be loaded globally');

const TMP_FORWARD = new THREE.Vector3();
const TMP_FLAT_FORWARD = new THREE.Vector3();
const TMP_UP = new THREE.Vector3(0, 0, 1);
const TMP_TARGET = new THREE.Vector3();
const TMP_LOOK = new THREE.Vector3();
const TMP_RIGHT = new THREE.Vector3();
const TMP_QUAT = new THREE.Quaternion();
const TMP_QUAT2 = new THREE.Quaternion();

export class ChaseCamera {
  constructor(camera, {
    distance = 55,
    height = 24,
    stiffness = 4,
    lookStiffness = 6,
    forwardResponsiveness = 4.5,
    pitchInfluence = 0.35,
  } = {}){
    this.camera = camera;
    this.distance = distance;
    this.height = height;
    this.stiffness = stiffness;
    this.lookStiffness = lookStiffness;
    this.forwardResponsiveness = forwardResponsiveness;
    this.pitchInfluence = pitchInfluence;
    this.currentPosition = camera.position.clone();
    this.currentForward = new THREE.Vector3(0, 1, 0);
    this.currentLookTarget = new THREE.Vector3();
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.maxOrbitYaw = THREE.MathUtils.degToRad(160);
    this.maxOrbitPitch = THREE.MathUtils.degToRad(70);
    this.orbitReturnSpeed = 2.6;
  }

  setConfig({ distance, height, stiffness, lookStiffness, forwardResponsiveness, pitchInfluence } = {}) {
    if (Number.isFinite(distance)) this.distance = distance;
    if (Number.isFinite(height)) this.height = height;
    if (Number.isFinite(stiffness)) this.stiffness = stiffness;
    if (Number.isFinite(lookStiffness)) this.lookStiffness = lookStiffness;
    if (Number.isFinite(forwardResponsiveness)) this.forwardResponsiveness = forwardResponsiveness;
    if (Number.isFinite(pitchInfluence)) this.pitchInfluence = pitchInfluence;
  }

  resetOrbit() {
    this.orbitYaw = 0;
    this.orbitPitch = 0;
  }

  snapTo(state) {
    if (!state?.position) return;
    if (!this.camera) return;
    if (state.orientation) {
      const forward = TMP_FORWARD.set(0, 1, 0).applyQuaternion(state.orientation).normalize();
      const flat = TMP_FLAT_FORWARD.copy(forward);
      flat.z = 0;
      if (flat.lengthSq() > 1e-4) {
        flat.normalize();
        this.currentForward.copy(flat);
      } else {
        this.currentForward.set(0, 1, 0);
      }
      const pitchFactor = THREE.MathUtils.clamp(forward.z, -0.75, 0.75);
      const desired = TMP_TARGET.copy(state.position)
        .addScaledVector(this.currentForward, -this.distance)
        .addScaledVector(TMP_UP, this.height + pitchFactor * this.distance * this.pitchInfluence);
      this.currentPosition.copy(desired);
    } else {
      this.currentPosition.copy(state.position).addScaledVector(TMP_UP, this.height);
    }
    this.camera.position.copy(this.currentPosition);
    this.currentLookTarget.copy(state.position);
    this.camera.up.copy(TMP_UP);
    this.camera.lookAt(this.currentLookTarget);
  }

  update({ position, orientation, velocity }, dt, orbitInput){
    if (!this.camera || !position || !orientation) return;
    const rawForward = TMP_FORWARD.set(0, 1, 0).applyQuaternion(orientation).normalize();

    const flatForward = TMP_FLAT_FORWARD.copy(rawForward);
    flatForward.z = 0;
    if (flatForward.lengthSq() < 1e-5){
      flatForward.copy(this.currentForward);
    } else {
      flatForward.normalize();
    }

    const forwardBlend = dt > 0 ? 1 - Math.exp(-this.forwardResponsiveness * dt) : 1;
    if (Number.isFinite(forwardBlend)){
      this.currentForward.lerp(flatForward, forwardBlend);
    } else {
      this.currentForward.copy(flatForward);
    }
    this.currentForward.normalize();

    this._updateOrbit(orbitInput, dt);

    const rotatedForward = TMP_FORWARD.copy(this.currentForward);
    if (this.orbitYaw !== 0) {
      rotatedForward.applyQuaternion(TMP_QUAT.setFromAxisAngle(TMP_UP, this.orbitYaw));
    }
    rotatedForward.normalize();
    if (this.orbitPitch !== 0) {
      const right = TMP_RIGHT.crossVectors(rotatedForward, TMP_UP);
      if (right.lengthSq() > 1e-5) {
        right.normalize();
        rotatedForward.applyQuaternion(TMP_QUAT2.setFromAxisAngle(right, this.orbitPitch));
      }
    }
    rotatedForward.normalize();

    const pitchFactor = THREE.MathUtils.clamp(rawForward.z, -0.75, 0.75);
    const heightOffset = this.height
      + pitchFactor * this.distance * this.pitchInfluence
      + Math.sin(this.orbitPitch) * this.distance * 0.6;

    const desired = TMP_TARGET.copy(position)
      .addScaledVector(rotatedForward, -this.distance)
      .addScaledVector(TMP_UP, heightOffset);

    const lerpFactor = dt > 0 ? 1 - Math.exp(-this.stiffness * dt) : 1;
    if (Number.isFinite(lerpFactor)){
      this.currentPosition.lerp(desired, lerpFactor);
    } else {
      this.currentPosition.copy(desired);
    }

    this.camera.position.copy(this.currentPosition);

    const target = TMP_LOOK.copy(position).addScaledVector(TMP_UP, Math.sin(this.orbitPitch) * 10);

    const lookBlend = dt > 0 ? 1 - Math.exp(-this.lookStiffness * dt) : 1;
    if (!Number.isFinite(this.currentLookTarget.lengthSq())){
      this.currentLookTarget.set(0, 0, 0);
    }
    if (Number.isFinite(lookBlend)){
      this.currentLookTarget.lerp(target, lookBlend);
    } else {
      this.currentLookTarget.copy(target);
    }

    this.camera.up.copy(TMP_UP);
    this.camera.lookAt(this.currentLookTarget);
  }

  _updateOrbit(orbitInput, dt) {
    if (!orbitInput) {
      const decay = dt > 0 ? 1 - Math.exp(-this.orbitReturnSpeed * dt) : 1;
      this.orbitYaw += (0 - this.orbitYaw) * decay;
      this.orbitPitch += (0 - this.orbitPitch) * decay;
      return;
    }

    if (orbitInput.active) {
      this.orbitYaw = THREE.MathUtils.clamp(this.orbitYaw + (orbitInput.yawDelta ?? 0), -this.maxOrbitYaw, this.maxOrbitYaw);
      this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + (orbitInput.pitchDelta ?? 0), -this.maxOrbitPitch, this.maxOrbitPitch);
    } else {
      const decay = dt > 0 ? 1 - Math.exp(-this.orbitReturnSpeed * dt) : 1;
      this.orbitYaw += (0 - this.orbitYaw) * decay;
      this.orbitPitch += (0 - this.orbitPitch) * decay;
    }
  }
}
