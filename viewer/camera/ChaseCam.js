const DEFAULT_BACK_OFFSET = 40;
const DEFAULT_UP_OFFSET = 20;
const LOOK_AHEAD_DISTANCE = 55;
const DEFAULT_POSITION_DAMPING = 6;
const DEFAULT_LOOK_DAMPING = 6;
const THREE_NS = (typeof window !== 'undefined' ? window.THREE : null) || (typeof THREE !== 'undefined' ? THREE : null);
if (!THREE_NS) {
  throw new Error('ChaseCam requires THREE to be loaded globally');
}
const { Vector3 } = THREE_NS;

const tmpDesired = new Vector3();
const tmpForward = new Vector3();
const tmpLook = new Vector3();

// Convert frame time and damping factor into a normalized lerp coefficient.
// This yields smooth exponential easing toward the desired target without
// relying on a velocity/spring simulation.

function computeLerpAlpha(dt, damping) {
  if (dt === Number.POSITIVE_INFINITY) return 1;
  if (!Number.isFinite(dt)) return 1;
  const safeDt = Math.max(0, dt);
  if (safeDt === 0) return 0;
  if (!Number.isFinite(damping) || damping <= 0) return 1;
  const alpha = 1 - Math.exp(-damping * safeDt);
  return alpha >= 1 ? 1 : alpha;
}

export class ChaseCam {
  constructor(camera) {
    this.camera = camera;
    this.target = null;
    this.backOffset = DEFAULT_BACK_OFFSET;
    this.upOffset = DEFAULT_UP_OFFSET;
    this.position = new Vector3();
    this.lookTarget = new Vector3();
    // Exponential smoothing factors that control how quickly the camera
    // aligns with the desired position and look targets.
    this.positionDampingFactor = DEFAULT_POSITION_DAMPING;
    this.lookDampingFactor = DEFAULT_LOOK_DAMPING;
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

  setPositionDampingFactor(factor) {
    if (typeof factor === 'number' && Number.isFinite(factor)) {
      this.positionDampingFactor = Math.max(0, factor);
    }
  }

  setLookDampingFactor(factor) {
    if (typeof factor === 'number' && Number.isFinite(factor)) {
      this.lookDampingFactor = Math.max(0, factor);
    }
  }

  snapToTarget() {
    if (!this.target) return;
    const desired = this.computeDesiredPosition(tmpDesired);
    this.position.copy(desired);
    this.computeLookTarget(tmpLook, Number.POSITIVE_INFINITY);
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
    const lerpT = computeLerpAlpha(dt, this.positionDampingFactor);
    if (lerpT >= 1) {
      this.position.copy(desired);
    } else if (lerpT > 0) {
      this.position.lerp(desired, lerpT);
    }

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

  computeLookTarget(out = new Vector3(), dt) {
    if (!this.target) return this.lookTarget.set(0, 0, 0);
    tmpForward.set(0, 1, 0).applyQuaternion(this.target.quaternion);
    out.copy(this.target.position).addScaledVector(tmpForward, LOOK_AHEAD_DISTANCE);
    const lerpT = computeLerpAlpha(dt, this.lookDampingFactor);
    if (lerpT >= 1 || lerpT <= 0) {
      this.lookTarget.copy(out);
    } else {
      this.lookTarget.lerp(out, lerpT);
    }
    return this.lookTarget;
  }
}
