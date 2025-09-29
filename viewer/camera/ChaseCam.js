const DEFAULT_BACK_OFFSET = 40;
const DEFAULT_UP_OFFSET = 20;
const SPRING_STRENGTH = 6.5;
const SPRING_DAMPING = 3.5;
const LOOK_AHEAD_DISTANCE = 55;
const LOOK_LERP_RATE = 6;
const THREE_NS = (typeof window !== 'undefined' ? window.THREE : null) || (typeof THREE !== 'undefined' ? THREE : null);
if (!THREE_NS) {
  throw new Error('ChaseCam requires THREE to be loaded globally');
}
const { Vector3 } = THREE_NS;

const tmpDesired = new Vector3();
const tmpStretch = new Vector3();
const tmpForward = new Vector3();
const tmpLook = new Vector3();

export class ChaseCam {
  constructor(camera) {
    this.camera = camera;
    this.target = null;
    this.backOffset = DEFAULT_BACK_OFFSET;
    this.upOffset = DEFAULT_UP_OFFSET;
    this.position = new Vector3();
    this.velocity = new Vector3();
    this.lookTarget = new Vector3();
    this.initialized = false;
  }

  follow(target) {
    if (this.target !== target) {
      this.target = target || null;
      this.initialized = false;
    }
    if (this.target && !this.initialized) {
      this.snapToTarget();
    }
  }

  setOffsets(back, up) {
    if (typeof back === 'number') {
      this.backOffset = Math.max(0, back);
    }
    if (typeof up === 'number') {
      this.upOffset = up;
    }
  }

  snapToTarget() {
    if (!this.target) return;
    const desired = this.computeDesiredPosition(tmpDesired);
    this.position.copy(desired);
    this.velocity.set(0, 0, 0);
    this.lookTarget.copy(this.target.position);
    this.camera.position.copy(desired);
    this.camera.lookAt(this.lookTarget);
    this.initialized = true;
  }

  update(dt) {
    if (!this.target || !Number.isFinite(dt)) return;
    if (!this.initialized) {
      this.snapToTarget();
      return;
    }
    const desired = this.computeDesiredPosition(tmpDesired);
    tmpStretch.subVectors(desired, this.position);
    const acceleration = tmpStretch.multiplyScalar(SPRING_STRENGTH);
    this.velocity.addScaledVector(acceleration, dt);
    const damping = Math.exp(-SPRING_DAMPING * dt);
    this.velocity.multiplyScalar(damping);
    this.position.addScaledVector(this.velocity, dt);

    this.camera.position.copy(this.position);

    this.computeLookTarget(tmpLook, dt);
    this.camera.lookAt(this.lookTarget);
  }

  computeDesiredPosition(out = new Vector3()) {
    if (!this.target) return out.set(0, 0, 0);
    tmpForward.set(0, -this.backOffset, this.upOffset);
    tmpForward.applyQuaternion(this.target.quaternion);
    out.copy(this.target.position).add(tmpForward);
    return out;
  }

  computeLookTarget(out, dt) {
    if (!this.target) return this.lookTarget.set(0, 0, 0);
    tmpForward.set(0, 1, 0).applyQuaternion(this.target.quaternion);
    out.copy(this.target.position).addScaledVector(tmpForward, LOOK_AHEAD_DISTANCE);
    const lerpT = 1 - Math.exp(-LOOK_LERP_RATE * (Number.isFinite(dt) ? dt : 0));
    if (!Number.isFinite(lerpT) || lerpT <= 0) {
      this.lookTarget.copy(out);
    } else {
      this.lookTarget.lerp(out, lerpT);
    }
    return this.lookTarget;
  }
}
