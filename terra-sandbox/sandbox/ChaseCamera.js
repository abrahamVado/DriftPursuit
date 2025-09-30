const THREE = (typeof window !== 'undefined' ? window.THREE : globalThis?.THREE) ?? null;
if (!THREE){
  throw new Error('ChaseCamera requires THREE to be available globally');
}

const FORWARD = new THREE.Vector3(0, 1, 0);
const UP = new THREE.Vector3(0, 0, 1);
const RIGHT = new THREE.Vector3(1, 0, 0);

function clamp(value, min, max){
  return Math.min(max, Math.max(min, value));
}

export class ChaseCamera {
  constructor(camera, config = {}){
    this.camera = camera;
    this.position = new THREE.Vector3();
    this.lookTarget = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.orbit = { yaw: 0, pitch: 0, active: false };
    this.config = {
      distance: 80,
      height: 20,
      stiffness: 4,
      lookStiffness: 6,
      forwardResponsiveness: 5,
      pitchInfluence: 0.25,
      orbitYawSpeed: 1.2,
      orbitPitchSpeed: 0.9,
      minPitch: THREE.MathUtils.degToRad(-50),
      maxPitch: THREE.MathUtils.degToRad(60),
      ...config,
    };
    if (this.camera){
      this.camera.position.copy(this.position);
    }
  }

  setConfig(config = {}){
    Object.assign(this.config, config);
  }

  resetOrbit(){
    this.orbit.yaw = 0;
    this.orbit.pitch = 0;
  }

  snapTo(state){
    if (!state || !state.position) return;
    this.position.copy(state.position);
    if (this.camera){
      this.camera.position.copy(this.position);
      const forward = FORWARD.clone().applyQuaternion(state.orientation ?? new THREE.Quaternion());
      this.camera.lookAt(state.position.clone().add(forward.multiplyScalar(10)));
    }
  }

  update(targetState, dt, orbitInput){
    if (!targetState || !targetState.position || !this.camera) return;
    const delta = Math.max(0, dt ?? 0);

    if (orbitInput){
      if (orbitInput.active){
        this.orbit.yaw += orbitInput.yawDelta ?? 0;
        this.orbit.pitch += orbitInput.pitchDelta ?? 0;
        this.orbit.pitch = clamp(this.orbit.pitch, this.config.minPitch, this.config.maxPitch);
        this.orbit.active = true;
      } else if (this.orbit.active){
        this.orbit.yaw *= Math.pow(0.82, delta * 60);
        this.orbit.pitch *= Math.pow(0.82, delta * 60);
      }
    }

    const orientation = targetState.orientation ?? new THREE.Quaternion();
    const forward = FORWARD.clone().applyQuaternion(orientation).normalize();
    const up = UP.clone().applyQuaternion(orientation).normalize();
    const right = RIGHT.clone().applyQuaternion(orientation).normalize();

    const distance = this.config.distance;
    const height = this.config.height;

    const orbitYawOffset = right.clone().multiplyScalar(this.orbit.yaw * distance * 0.4);
    const orbitPitchOffset = up.clone().multiplyScalar(this.orbit.pitch * distance * 0.35);

    const desiredPosition = targetState.position.clone()
      .addScaledVector(forward, -distance)
      .addScaledVector(up, height)
      .add(orbitYawOffset)
      .add(orbitPitchOffset);

    const stiffness = this.config.stiffness;
    const lerpFactor = delta > 0 ? 1 - Math.exp(-stiffness * delta) : 1;
    this.position.lerp(desiredPosition, lerpFactor);

    const targetLook = targetState.position.clone();
    const lookAhead = forward.clone().multiplyScalar(this.config.forwardResponsiveness * 6);
    targetLook.add(lookAhead);
    targetLook.addScaledVector(up, this.config.pitchInfluence * (targetState.velocity?.z ?? 0));
    targetLook.add(orbitPitchOffset);
    targetLook.add(orbitYawOffset);

    const lookLerp = delta > 0 ? 1 - Math.exp(-this.config.lookStiffness * delta) : 1;
    this.lookTarget.lerp(targetLook, lookLerp);

    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookTarget);
  }
}
