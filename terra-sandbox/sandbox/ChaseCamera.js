const THREE = (typeof window !== 'undefined' ? window.THREE : globalThis?.THREE) ?? null;
if (!THREE) throw new Error('ChaseCamera requires THREE to be available globally');

// Temps
const TMP_FORWARD = new THREE.Vector3();
const TMP_FLAT_FORWARD = new THREE.Vector3();
const TMP_UP = new THREE.Vector3(0, 0, 1);
const TMP_TARGET = new THREE.Vector3();
const TMP_LOOK = new THREE.Vector3();
const TMP_RIGHT = new THREE.Vector3();
const TMP_QUAT = new THREE.Quaternion();
const TMP_QUAT2 = new THREE.Quaternion();

function clamp(v, a, b){ return Math.min(b, Math.max(a, v)); }
function smoothFactor(rate, dt){ return dt > 0 ? 1 - Math.exp(-rate * dt) : 1; }

/**
 * Third-person chase camera with:
 *  - Smooth follow (stiffness, lookStiffness)
 *  - Forward direction smoothing (forwardResponsiveness)
 *  - Orbit input (yaw/pitch) with decay & limits
 *  - Pitch-based height influence (pitchInfluence)
 *  - Snap/reset helpers
 */
export class ChaseCamera {
  constructor(camera, {
    distance = 70,
    height = 22,
    stiffness = 4,
    lookStiffness = 6,
    forwardResponsiveness = 5,
    pitchInfluence = 0.3,
    // orbit
    maxOrbitYaw = THREE.MathUtils.degToRad(160),
    maxOrbitPitch = THREE.MathUtils.degToRad(70),
    orbitReturnSpeed = 2.6, // decay back to 0 when not active
  } = {}){
    this.camera = camera;

    // config
    this.distance = distance;
    this.height = height;
    this.stiffness = stiffness;
    this.lookStiffness = lookStiffness;
    this.forwardResponsiveness = forwardResponsiveness;
    this.pitchInfluence = pitchInfluence;

    this.maxOrbitYaw = maxOrbitYaw;
    this.maxOrbitPitch = maxOrbitPitch;
    this.orbitReturnSpeed = orbitReturnSpeed;

    // state
    this.currentPosition = camera?.position.clone() ?? new THREE.Vector3();
    this.currentForward = new THREE.Vector3(0, 1, 0);
    this.currentLookTarget = new THREE.Vector3();
    this.orbitYaw = 0;
    this.orbitPitch = 0;
  }

  setConfig(cfg = {}){
    for (const k of [
      'distance','height','stiffness','lookStiffness',
      'forwardResponsiveness','pitchInfluence',
      'maxOrbitYaw','maxOrbitPitch','orbitReturnSpeed'
    ]) if (k in cfg && Number.isFinite(cfg[k])) this[k] = cfg[k];
  }

  resetOrbit(){
    this.orbitYaw = 0;
    this.orbitPitch = 0;
  }

  snapTo(state){
    if (!state?.position || !this.camera) return;

    if (state.orientation){
      const forward = TMP_FORWARD.set(0, 1, 0).applyQuaternion(state.orientation).normalize();
      const flat = TMP_FLAT_FORWARD.copy(forward); flat.z = 0;

      if (flat.lengthSq() > 1e-4){
        flat.normalize();
        this.currentForward.copy(flat);
      } else {
        this.currentForward.set(0, 1, 0);
      }

      const pitchFactor = clamp(forward.z, -0.75, 0.75);
      const desired = TMP_TARGET.copy(state.position)
        .addScaledVector(this.currentForward, -this.distance)
        .addScaledVector(TMP_UP, this.height + pitchFactor * this.distance * this.pitchInfluence);

      this.currentPosition.copy(desired);
      this.currentLookTarget.copy(state.position);
    } else {
      this.currentPosition.copy(state.position).addScaledVector(TMP_UP, this.height);
      this.currentLookTarget.copy(state.position);
    }

    this.camera.up.copy(TMP_UP);
    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(this.currentLookTarget);
  }

  update(targetState, dt, orbitInput){
    if (!this.camera || !targetState?.position || !targetState.orientation) return;
    const rawForward = TMP_FORWARD.set(0, 1, 0).applyQuaternion(targetState.orientation).normalize();

    // Smooth the flat forward (ignore Z to avoid roll/pitch noise in follow offset)
    const flatForward = TMP_FLAT_FORWARD.copy(rawForward); flatForward.z = 0;
    if (flatForward.lengthSq() < 1e-5) flatForward.copy(this.currentForward); else flatForward.normalize();

    const fBlend = smoothFactor(this.forwardResponsiveness, dt);
    this.currentForward.lerp(flatForward, fBlend).normalize();

    // Orbit input handling
    this._updateOrbit(orbitInput, dt);

    // Apply orbit yaw/pitch around currentForward
    const rotatedForward = TMP_FORWARD.copy(this.currentForward);
    if (this.orbitYaw !== 0){
      rotatedForward.applyQuaternion(TMP_QUAT.setFromAxisAngle(TMP_UP, this.orbitYaw));
    }
    rotatedForward.normalize();

    if (this.orbitPitch !== 0){
      const right = TMP_RIGHT.crossVectors(rotatedForward, TMP_UP);
      if (right.lengthSq() > 1e-5){
        right.normalize();
        rotatedForward.applyQuaternion(TMP_QUAT2.setFromAxisAngle(right, this.orbitPitch));
        rotatedForward.normalize();
      }
    }

    // Height from pitch of the target's forward + extra from orbit pitch
    const pitchFactor = clamp(rawForward.z, -0.75, 0.75);
    const heightOffset = this.height
      + pitchFactor * this.distance * this.pitchInfluence
      + Math.sin(this.orbitPitch) * this.distance * 0.6;

    const desired = TMP_TARGET.copy(targetState.position)
      .addScaledVector(rotatedForward, -this.distance)
      .addScaledVector(TMP_UP, heightOffset);

    const pBlend = smoothFactor(this.stiffness, dt);
    this.currentPosition.lerp(desired, pBlend);
    this.camera.position.copy(this.currentPosition);

    // Look target (slightly ahead + orbit pitch lift)
    const lookOffset = Math.sin(this.orbitPitch) * 10;
    const lookTarget = TMP_LOOK.copy(targetState.position).addScaledVector(TMP_UP, lookOffset);

    const lBlend = smoothFactor(this.lookStiffness, dt);
    this.currentLookTarget.lerp(lookTarget, lBlend);

    this.camera.up.copy(TMP_UP);
    this.camera.lookAt(this.currentLookTarget);
  }

  _updateOrbit(orbitInput, dt){
    if (!orbitInput || !orbitInput.active){
      const decay = smoothFactor(this.orbitReturnSpeed, dt);
      this.orbitYaw += (0 - this.orbitYaw) * decay;
      this.orbitPitch += (0 - this.orbitPitch) * decay;
      return;
    }
    // Active input
    this.orbitYaw = clamp(this.orbitYaw + (orbitInput.yawDelta ?? 0), -this.maxOrbitYaw, this.maxOrbitYaw);
    this.orbitPitch = clamp(this.orbitPitch + (orbitInput.pitchDelta ?? 0), -this.maxOrbitPitch, this.maxOrbitPitch);
  }
}
