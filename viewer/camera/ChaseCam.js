// ChaseCam.js
// Three.js r150+
// Usage:
// const chase = new ChaseCam(camera, { mode: 'spring' });
// chase.follow(planeGroup);
// in render loop: chase.update(delta);

const THREE_NS = (typeof window !== 'undefined' ? window.THREE : null) || (typeof THREE !== 'undefined' ? THREE : null);
if (!THREE_NS) throw new Error('ChaseCam requires THREE to be loaded globally');

const { Euler, Quaternion, Vector3 } = THREE_NS;

// Defaults (can be overridden via constructor options)
const DEFAULTS = {
  backOffset: 50,          // distance behind target
  upOffset: 10,            // height above target
  lookAhead: 55,           // how far ahead we look
  positionDamping: 6,      // exp smoothing factor (1/s)
  lookDamping: 6,          // exp smoothing factor (1/s)
  mode: 'exp',             // 'exp' | 'spring'
  springStrength: 6.5,     // only for mode: 'spring'
  springDamping: 3.5       // only for mode: 'spring'
};

// Scratch
const TMP = {
  desired: new Vector3(),
  forward: new Vector3(),
  look: new Vector3(),
  euler: new Euler(0, 0, 0, 'ZYX'),
  quat: new Quaternion(),
  quatNoRoll: new Quaternion(),
};

function getQuaternionWithoutRoll(source, out = TMP.quatNoRoll) {
  if (!source) return out.identity();
  TMP.quat.copy(source);
  TMP.euler.setFromQuaternion(TMP.quat, TMP.euler.order);
  TMP.euler.x = 0;                      // remove roll (bank)
  out.setFromEuler(TMP.euler);
  return out;
}

// Frame-rate independent exponential lerp coefficient
function computeLerpAlpha(dt, dampingPerSec) {
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  if (!Number.isFinite(dampingPerSec) || dampingPerSec <= 0) return 1;
  const a = 1 - Math.exp(-dampingPerSec * dt);
  return a >= 1 ? 1 : a;
}

export class ChaseCam {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {Object} [opts]
   */
  constructor(camera, opts = {}) {
    this.camera = camera;
    this.target = null;

    // options
    this.backOffset = opts.backOffset ?? DEFAULTS.backOffset;
    this.upOffset = opts.upOffset ?? DEFAULTS.upOffset;
    this.lookAhead = opts.lookAhead ?? DEFAULTS.lookAhead;

    this.positionDampingFactor = opts.positionDamping ?? DEFAULTS.positionDamping;
    this.lookDampingFactor = opts.lookDamping ?? DEFAULTS.lookDamping;

    this.mode = (opts.mode === 'spring') ? 'spring' : 'exp';
    this.springStrength = opts.springStrength ?? DEFAULTS.springStrength;
    this.springDamping = opts.springDamping ?? DEFAULTS.springDamping;

    // state
    this.position = new Vector3();
    this.lookTarget = new Vector3();
    this.velocity = new Vector3();     // used for spring mode
    this.initialized = false;

    // Camera up is Y+
    if (this.camera && this.camera.up) this.camera.up.set(0, 1, 0);
  }

  follow(target) {
    if (this.target !== target) {
      this.target = target || null;
      this.initialized = false;
    }
    if (this.target && !this.initialized) this.snapToTarget();
  }

  setOffsets(back, up) {
    if (typeof back === 'number') this.backOffset = Math.max(0, back);
    if (typeof up === 'number') this.upOffset = up;
  }

  setPositionDampingFactor(f) {
    if (Number.isFinite(f) && f >= 0) this.positionDampingFactor = f;
  }

  setLookDampingFactor(f) {
    if (Number.isFinite(f) && f >= 0) this.lookDampingFactor = f;
  }

  setMode(mode) {
    this.mode = (mode === 'spring') ? 'spring' : 'exp';
    // reset velocity when switching away from spring
    if (this.mode !== 'spring') this.velocity.set(0, 0, 0);
  }

  setSpring(strength, damping) {
    if (Number.isFinite(strength)) this.springStrength = Math.max(0, strength);
    if (Number.isFinite(damping)) this.springDamping = Math.max(0, damping);
  }

  snapToTarget() {
    if (!this.target) return;
    const desired = this.computeDesiredPosition(TMP.desired);
    this.position.copy(desired);

    // Reset velocity for spring mode
    this.velocity.set(0, 0, 0);

    // Look instantly for a clean start
    this.computeLookTarget(TMP.look, Number.POSITIVE_INFINITY);
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

    const desired = this.computeDesiredPosition(TMP.desired);

    if (this.mode === 'spring') {
      // Critically-damped-ish mass-spring (unit mass)
      // x'' = k*(x_des - x) - c*x'
      // semi-implicit Euler
      const toTarget = TMP.forward.copy(desired).sub(this.position);
      const accel = toTarget.multiplyScalar(this.springStrength).addScaledVector(this.velocity, -this.springDamping);
      // integrate
      this.velocity.addScaledVector(accel, dt);
      this.position.addScaledVector(this.velocity, dt);
    } else {
      // Exponential smoothing toward desired
      const t = computeLerpAlpha(dt, this.positionDampingFactor);
      if (t >= 1) this.position.copy(desired);
      else if (t > 0) this.position.lerp(desired, t);
    }

    this.camera.position.copy(this.position);

    // Smooth look-at target
    this.computeLookTarget(TMP.look, dt);
    this.camera.lookAt(this.lookTarget);
  }

  computeDesiredPosition(out = new Vector3()) {
    if (!this.target) return out.set(0, 0, 0);
    // Offset expressed in target’s yaw/pitch frame (no roll)
    TMP.forward.set(0, -this.backOffset, this.upOffset);
    TMP.forward.applyQuaternion(getQuaternionWithoutRoll(this.target.quaternion));
    out.copy(this.target.position).add(TMP.forward);
    return out;
  }

  computeLookTarget(out = new Vector3(), dt = 0) {
    if (!this.target) return this.lookTarget.set(0, 0, 0);
    // Look ahead along target forward (no roll)
    TMP.forward
      .set(1, 0, 0) // +X is "forward" in our plane rig
      .applyQuaternion(getQuaternionWithoutRoll(this.target.quaternion));

    out.copy(this.target.position).addScaledVector(TMP.forward, this.lookAhead);

    const t = computeLerpAlpha(dt, this.lookDampingFactor);
    if (t >= 1 || t <= 0) this.lookTarget.copy(out);
    else this.lookTarget.lerp(out, t);

    return this.lookTarget;
  }
}
