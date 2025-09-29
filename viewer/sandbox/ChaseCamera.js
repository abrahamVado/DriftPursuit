const THREE = (typeof window !== 'undefined' ? window.THREE : globalThis?.THREE) ?? null;
if (!THREE) throw new Error('Sandbox ChaseCamera requires THREE to be loaded globally');

const TMP_FORWARD = new THREE.Vector3();
const TMP_FLAT_FORWARD = new THREE.Vector3();
const TMP_UP = new THREE.Vector3(0, 0, 1);
const TMP_TARGET = new THREE.Vector3();
const TMP_LOOK = new THREE.Vector3();

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
  }

  update({ position, orientation, velocity }, dt){
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

    const pitchFactor = THREE.MathUtils.clamp(rawForward.z, -0.75, 0.75);
    const heightOffset = this.height + pitchFactor * this.distance * this.pitchInfluence;

    const desired = TMP_TARGET.copy(position)
      .addScaledVector(this.currentForward, -this.distance)
      .addScaledVector(TMP_UP, heightOffset);

    const lerpFactor = dt > 0 ? 1 - Math.exp(-this.stiffness * dt) : 1;
    if (Number.isFinite(lerpFactor)){
      this.currentPosition.lerp(desired, lerpFactor);
    } else {
      this.currentPosition.copy(desired);
    }

    this.camera.position.copy(this.currentPosition);

    const target = TMP_LOOK.copy(position);

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
}
