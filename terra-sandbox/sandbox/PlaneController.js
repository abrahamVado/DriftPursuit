const THREE = (typeof window !== 'undefined' ? window.THREE : globalThis?.THREE) ?? null;
if (!THREE){
  throw new Error('PlaneController requires THREE to be available globally');
}

const FORWARD = new THREE.Vector3(0, 1, 0);

export class PlaneController {
  constructor({
    maxSpeed = 320,
    maxBoostSpeed = 420,
    acceleration = 180,
    throttleResponse = 2.4,
    drag = 0.18,
    pitchRate = THREE.MathUtils.degToRad(120),
    rollRate = THREE.MathUtils.degToRad(180),
    yawRate = THREE.MathUtils.degToRad(90),
  } = {}){
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.orientation = new THREE.Quaternion();
    this.angularVelocity = new THREE.Vector3();
    this.mesh = null;

    this.maxSpeed = maxSpeed;
    this.maxBoostSpeed = maxBoostSpeed;
    this.acceleration = acceleration;
    this.drag = drag;
    this.pitchRate = pitchRate;
    this.rollRate = rollRate;
    this.yawRate = yawRate;
    this.throttleResponse = throttleResponse;

    this.throttle = 0;
    this.targetThrottle = 0;
    this.speed = 0;
    this.propulsorHeat = 0;

    this.aim = { x: 0, y: 0 };

    this._tmpEuler = new THREE.Euler();
    this._tmpForward = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
  }

  attachMesh(mesh){
    this.mesh = mesh ?? null;
    if (this.mesh){
      this.mesh.position.copy(this.position);
      this.mesh.quaternion.copy(this.orientation);
    }
  }

  reset({ position, velocity, yaw = 0, pitch = 0, roll = 0, throttle = 0 } = {}){
    if (position){ this.position.copy(position); } else { this.position.set(0, 0, 0); }
    if (velocity){ this.velocity.copy(velocity); } else { this.velocity.set(0, 0, 0); }
    this._tmpQuat.setFromEuler(new THREE.Euler(pitch, yaw, roll, 'ZYX'));
    this.orientation.copy(this._tmpQuat);
    this.angularVelocity.set(0, 0, 0);
    this.throttle = THREE.MathUtils.clamp(throttle ?? 0, 0, 1);
    this.targetThrottle = this.throttle;
    this.speed = this.velocity.length();
    this.propulsorHeat = this.throttle;
    this.aim.x = 0;
    this.aim.y = 0;
    if (this.mesh){
      this.mesh.position.copy(this.position);
      this.mesh.quaternion.copy(this.orientation);
    }
  }

  setThrottle(value){
    this.targetThrottle = THREE.MathUtils.clamp(value ?? 0, 0, 1);
  }

  _applyPropulsorIntensity(intensity){
    this.propulsorHeat = THREE.MathUtils.clamp(intensity ?? this.throttle, 0, 1);
  }

  update(dt, input = {}, extra = {}){
    const delta = Math.max(0, dt ?? 0);

    if (input.aim){
      this.aim.x = THREE.MathUtils.clamp(input.aim.x ?? 0, -1, 1);
      this.aim.y = THREE.MathUtils.clamp(input.aim.y ?? 0, -1, 1);
    }

    const throttleAdjust = THREE.MathUtils.clamp(input.throttleAdjust ?? 0, -1, 1);
    this.targetThrottle = THREE.MathUtils.clamp(this.targetThrottle + throttleAdjust * delta, 0, 1);
    const blend = delta > 0 ? 1 - Math.exp(-this.throttleResponse * delta) : 1;
    this.throttle += (this.targetThrottle - this.throttle) * blend;
    this._applyPropulsorIntensity(this.throttle);

    let desiredSpeed = this.maxSpeed * this.throttle;
    if (input.brake){
      desiredSpeed = Math.min(desiredSpeed, this.speed - this.acceleration * delta);
    } else if (this.throttle > 0.99 && this.maxBoostSpeed > this.maxSpeed){
      desiredSpeed = THREE.MathUtils.lerp(desiredSpeed, this.maxBoostSpeed, this.throttle * 0.2);
    }

    const acceleration = (desiredSpeed - this.speed) * Math.min(1, this.acceleration * delta / Math.max(1, this.maxSpeed));
    this.speed += acceleration;
    if (!input.brake){
      this.speed = Math.max(0, this.speed - this.drag * this.speed * delta * 0.2);
    } else {
      this.speed = Math.max(0, this.speed);
    }

    const pitchInput = THREE.MathUtils.clamp(input.pitch ?? 0, -1, 1);
    const rollInput = THREE.MathUtils.clamp(input.roll ?? 0, -1, 1);
    const yawInput = THREE.MathUtils.clamp(input.yaw ?? 0, -1, 1);

    this._tmpEuler.set(
      pitchInput * this.pitchRate * delta,
      yawInput * this.yawRate * delta,
      rollInput * this.rollRate * delta,
      'XYZ',
    );
    this._tmpQuat.setFromEuler(this._tmpEuler);
    this.orientation.multiply(this._tmpQuat).normalize();

    this._tmpForward.copy(FORWARD).applyQuaternion(this.orientation).normalize();
    this.velocity.copy(this._tmpForward).multiplyScalar(this.speed);
    this.position.addScaledVector(this.velocity, delta);

    if (typeof extra.sampleGroundHeight === 'function'){
      const ground = extra.sampleGroundHeight(this.position.x, this.position.y);
      if (Number.isFinite(ground) && this.position.z < ground + 0.5){
        this.position.z = ground + 0.5;
        if (this.velocity.z < 0) this.velocity.z = 0;
      }
    }

    if (typeof extra.clampAltitude === 'function'){
      extra.clampAltitude(this, extra.sampleGroundHeight?.(this.position.x, this.position.y) ?? 0);
    }

    if (this.mesh){
      this.mesh.position.copy(this.position);
      this.mesh.quaternion.copy(this.orientation);
    }
  }

  getState(){
    return {
      position: this.position.clone(),
      velocity: this.velocity.clone(),
      orientation: this.orientation.clone(),
      throttle: this.throttle,
      targetThrottle: this.targetThrottle,
      speed: this.speed,
      aim: { x: this.aim.x, y: this.aim.y },
    };
  }
}

export function createPlaneMesh(){
  const fuselageMaterial = new THREE.MeshStandardMaterial({ color: 0xf0f3ff, metalness: 0.35, roughness: 0.45 });
  const noseMaterial = new THREE.MeshStandardMaterial({ color: 0xd13b4a, metalness: 0.4, roughness: 0.3 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: 0x2a4f9b, metalness: 0.45, roughness: 0.32 });

  const group = new THREE.Group();
  const fuselageGeometry = new THREE.CapsuleGeometry(2.1, 11.5, 8, 16);
  const fuselage = new THREE.Mesh(fuselageGeometry, fuselageMaterial);
  fuselage.rotation.z = Math.PI / 2;
  fuselage.castShadow = true;
  fuselage.receiveShadow = true;
  group.add(fuselage);

  const noseGeometry = new THREE.ConeGeometry(2.1, 4.2, 14);
  const nose = new THREE.Mesh(noseGeometry, noseMaterial);
  nose.position.set(0, 8.8, 0);
  nose.rotation.x = Math.PI;
  nose.castShadow = true;
  group.add(nose);

  const wingGeometry = new THREE.BoxGeometry(16, 3, 0.6);
  const wing = new THREE.Mesh(wingGeometry, accentMaterial);
  wing.position.set(0, 0.4, 0);
  wing.castShadow = true;
  wing.receiveShadow = true;
  group.add(wing);

  const tailGeometry = new THREE.BoxGeometry(6, 2, 0.5);
  const tail = new THREE.Mesh(tailGeometry, accentMaterial);
  tail.position.set(0, -6.2, 0);
  tail.castShadow = true;
  tail.receiveShadow = true;
  group.add(tail);

  group.traverse((child) => {
    if (child.isMesh){
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return group;
}
