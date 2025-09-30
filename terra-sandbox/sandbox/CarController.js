const THREE = (typeof window !== 'undefined' ? window.THREE : globalThis?.THREE) ?? null;
if (!THREE){
  throw new Error('CarController requires THREE to be available globally');
}

function clamp(value, min, max){
  return Math.min(max, Math.max(min, value));
}

export class CarController {
  constructor({
    maxSpeed = 140,
    acceleration = 120,
    brakeDeceleration = 220,
    drag = 1.6,
    steeringRate = THREE.MathUtils.degToRad(120),
    steeringResponse = 6.5,
    throttleResponse = 4.5,
    suspensionHeight = 1.8,
  } = {}){
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.orientation = new THREE.Quaternion();
    this.mesh = null;

    this.maxSpeed = maxSpeed;
    this.acceleration = acceleration;
    this.brakeDeceleration = brakeDeceleration;
    this.drag = drag;
    this.steeringRate = steeringRate;
    this.steeringResponse = steeringResponse;
    this.throttleResponse = throttleResponse;
    this.suspensionHeight = suspensionHeight;

    this.throttle = 0;
    this.targetThrottle = 0;
    this.speed = 0;
    this.yaw = 0;
    this.currentSteer = 0;
    this.aim = { x: 0, y: 0 };

    this.turretYaw = 0;
    this.turretPitch = 0;
    this.turretResponse = 8.5;
    this.turretYawLimit = THREE.MathUtils.degToRad(150);
    this.turretPitchLimit = THREE.MathUtils.degToRad(55);

    this.attachments = {
      towerGroup: null,
      towerHead: null,
      stickYaw: null,
      stickPitch: null,
      wheels: [],
    };

    this._tmpForward = new THREE.Vector3();
  }

  attachMesh(mesh, {
    towerGroup = null,
    towerHead = null,
    stickYaw = null,
    stickPitch = null,
    wheels = [],
  } = {}){
    this.mesh = mesh ?? null;
    this.attachments = {
      towerGroup,
      towerHead,
      stickYaw,
      stickPitch,
      wheels: Array.isArray(wheels) ? wheels : [],
    };
    if (this.mesh){
      this.mesh.position.copy(this.position);
      this.mesh.quaternion.copy(this.orientation);
    }
  }

  reset({ position, yaw = 0, throttle = 0 } = {}){
    if (position){ this.position.copy(position); } else { this.position.set(0, 0, 0); }
    this.yaw = yaw;
    this.orientation.setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.yaw);
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.currentSteer = 0;
    this.throttle = clamp(throttle ?? 0, -1, 1);
    this.targetThrottle = this.throttle;
    this.aim.x = 0;
    this.aim.y = 0;
    this.turretYaw = 0;
    this.turretPitch = 0;
    if (this.mesh){
      this.mesh.position.copy(this.position);
      this.mesh.quaternion.copy(this.orientation);
    }
  }

  setTurretAim(aim){
    if (!aim) return;
    this.aim.x = clamp(aim.x ?? 0, -1, 1);
    this.aim.y = clamp(aim.y ?? 0, -1, 1);
  }

  _updateTurret(dt){
    const targetYaw = this.aim.x * this.turretYawLimit;
    const targetPitch = this.aim.y * this.turretPitchLimit;
    const blend = dt > 0 ? 1 - Math.exp(-this.turretResponse * dt) : 1;
    this.turretYaw += (targetYaw - this.turretYaw) * blend;
    this.turretPitch += (targetPitch - this.turretPitch) * blend;
    this.turretYaw = clamp(this.turretYaw, -this.turretYawLimit, this.turretYawLimit);
    this.turretPitch = clamp(this.turretPitch, -this.turretPitchLimit, this.turretPitchLimit);

    const { towerGroup, towerHead, stickYaw, stickPitch, wheels } = this.attachments;
    if (towerGroup){
      towerGroup.rotation.z = this.turretYaw;
    }
    if (towerHead){
      towerHead.rotation.x = this.turretPitch;
    }
    if (stickYaw){
      stickYaw.rotation.z = this.currentSteer * 0.6;
    }
    if (stickPitch){
      stickPitch.rotation.x = this.throttle * 0.4;
    }
    if (Array.isArray(wheels)){
      const rotationDelta = this.speed * dt * 0.4;
      wheels.forEach((wheel) => {
        if (wheel && wheel.rotation){
          wheel.rotation.x -= rotationDelta;
        }
      });
    }
  }

  update(dt, input = {}, extra = {}){
    const delta = Math.max(0, dt ?? 0);

    if (input.aim){
      this.setTurretAim(input.aim);
    }

    const throttleInput = clamp(input.throttle ?? 0, -1, 1);
    this.targetThrottle = throttleInput;
    const throttleBlend = delta > 0 ? 1 - Math.exp(-this.throttleResponse * delta) : 1;
    this.throttle += (this.targetThrottle - this.throttle) * throttleBlend;

    const accel = this.throttle * this.acceleration;
    this.speed += accel * delta;
    this.speed -= this.drag * this.speed * delta;
    if (input.brake){
      this.speed -= this.brakeDeceleration * delta;
    }
    this.speed = clamp(this.speed, -this.maxSpeed * 0.35, this.maxSpeed);

    const steerInput = clamp(input.steer ?? 0, -1, 1);
    this.currentSteer += (steerInput - this.currentSteer) * (delta > 0 ? 1 - Math.exp(-this.steeringResponse * delta) : 1);
    const steerScale = 0.35 + 0.65 * clamp(Math.abs(this.speed) / Math.max(1, this.maxSpeed), 0, 1);
    this.yaw += this.currentSteer * this.steeringRate * steerScale * delta;
    this.orientation.setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.yaw);

    this._tmpForward.set(0, 1, 0).applyQuaternion(this.orientation);
    this.velocity.copy(this._tmpForward).multiplyScalar(this.speed);
    this.position.addScaledVector(this.velocity, delta);

    if (typeof extra.sampleGroundHeight === 'function'){
      const ground = extra.sampleGroundHeight(this.position.x, this.position.y);
      if (Number.isFinite(ground)){
        this.position.z = ground + this.suspensionHeight;
      }
    }

    if (this.mesh){
      this.mesh.position.copy(this.position);
      this.mesh.quaternion.copy(this.orientation);
    }

    this._updateTurret(delta);
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

export function createCarRig(){
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x3a4a66, metalness: 0.4, roughness: 0.55 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: 0x85c8ff, metalness: 0.6, roughness: 0.4 });
  const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x1f242b, metalness: 0.3, roughness: 0.8 });

  const carMesh = new THREE.Group();
  carMesh.name = 'TerraCar';

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(14, 32, 4.5), bodyMaterial);
  chassis.position.set(0, 0, 3.2);
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  carMesh.add(chassis);

  const canopy = new THREE.Mesh(new THREE.ConeGeometry(6, 8, 12), accentMaterial);
  canopy.position.set(0, 2, 8.2);
  canopy.castShadow = true;
  canopy.receiveShadow = true;
  carMesh.add(canopy);

  const wheelGeometry = new THREE.CylinderGeometry(3.4, 3.4, 3, 14);
  const wheelPositions = [
    [-6, 11, 1.6],
    [6, 11, 1.6],
    [-6, -11, 1.6],
    [6, -11, 1.6],
  ];
  const wheels = wheelPositions.map(([x, y, z]) => {
    const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, y, z);
    wheel.castShadow = true;
    wheel.receiveShadow = true;
    carMesh.add(wheel);
    return wheel;
  });

  const towerGroup = new THREE.Group();
  towerGroup.position.set(0, 0, 7.6);
  carMesh.add(towerGroup);

  const towerBase = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 3.2, 12), bodyMaterial);
  towerBase.position.set(0, 0, 1.6);
  towerBase.castShadow = true;
  towerBase.receiveShadow = true;
  towerGroup.add(towerBase);

  const towerHead = new THREE.Group();
  towerHead.position.set(0, 0, 3.2);
  towerGroup.add(towerHead);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 10, 10), accentMaterial);
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0, 4.6, 0);
  barrel.castShadow = true;
  barrel.receiveShadow = true;
  towerHead.add(barrel);

  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.8, 10), accentMaterial);
  muzzle.rotation.z = Math.PI / 2;
  muzzle.position.set(0, 9.2, 0);
  muzzle.castShadow = true;
  muzzle.receiveShadow = true;
  towerHead.add(muzzle);

  carMesh.userData.turretMuzzle = muzzle;

  const stickBase = new THREE.Group();
  stickBase.position.set(0, -4, 6);
  carMesh.add(stickBase);

  const stickYaw = new THREE.Group();
  stickBase.add(stickYaw);

  const stickPitch = new THREE.Group();
  stickPitch.position.set(0, 0, 2);
  stickYaw.add(stickPitch);

  const stickMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 4.5, 8), accentMaterial);
  stickMesh.position.set(0, 0, 2);
  stickMesh.castShadow = true;
  stickMesh.receiveShadow = true;
  stickPitch.add(stickMesh);

  return {
    carMesh,
    towerGroup,
    towerHead,
    stickYaw,
    stickPitch,
    wheels,
  };
}
