import THREE from '../shared/threeProxy.js';

if (!THREE) throw new Error('CarController requires THREE to be available globally');

// ------------------------- utils -------------------------
function clamp(value, min, max){
  return Math.min(max, Math.max(min, value));
}

const FORWARD_AXIS = new THREE.Vector3(0, 1, 0);
const TMP_FORWARD = new THREE.Vector3();
const TMP_EULER = new THREE.Euler(0, 0, 0, 'ZXY');

// --------------------- CarController ---------------------
export class CarController {
  /**
   * Ground vehicle controller with smoothed throttle/steer,
   * turret/aim manipulation, wheel rotation, and simple ground follow.
   */
  constructor({
    // movement
    maxForwardSpeed = 62,
    maxReverseSpeed = 26,
    acceleration = 120,          // used in throttle mode
    brakeDeceleration = 220,
    drag = 1.8,
    speedResponse = 4.2,         // used in target-speed mode
    throttleResponse = 4.5,      // used in throttle mode
    // steering
    turnRate = THREE.MathUtils.degToRad(75),
    steeringRate = THREE.MathUtils.degToRad(120),
    turnSmoothing = 8.5,
    steeringResponse = 6.5,
    // visuals/feel
    leanResponse = 6.5,
    suspensionHeight = 2.1,
  } = {}){
    // state
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.orientation = new THREE.Quaternion();
    this.mesh = null;

    // params (blend of both variants, pick what you use)
    this.maxForwardSpeed = maxForwardSpeed;
    this.maxReverseSpeed = maxReverseSpeed;
    this.acceleration = acceleration;
    this.brakeDeceleration = brakeDeceleration;
    this.drag = drag;

    this.turnRate = turnRate;
    this.steeringRate = steeringRate;
    this.turnSmoothing = turnSmoothing;
    this.steeringResponse = steeringResponse;

    this.speedResponse = speedResponse;
    this.throttleResponse = throttleResponse;
    this.leanResponse = leanResponse;
    this.suspensionHeight = suspensionHeight;

    // inputs/state
    this.yaw = 0;
    this.lean = 0;
    this.speed = 0;

    this.throttle = 0;
    this.targetThrottle = 0;
    this.currentSteer = 0;

    // aim/turret
    this.aim = { x: 0, y: 0 };
    this.turretYaw = 0;
    this.turretPitch = 0;
    this.turretResponse = 8.5;
    this.turretYawLimit = THREE.MathUtils.degToRad(150);
    this.turretPitchLimit = THREE.MathUtils.degToRad(55);

    // attachments
    this.attachments = {
      towerGroup: null,
      towerHead: null,
      stickYaw: null,
      stickPitch: null,
      wheels: [],
    };

    // temp vec
    this._tmpForward = new THREE.Vector3();

    this._updateOrientation();
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
    this.lean = 0;
    this.speed = 0;
    this.velocity.set(0, 0, 0);
    this.currentSteer = 0;
    this.throttle = clamp(throttle ?? 0, -1, 1);
    this.targetThrottle = this.throttle;
    this.aim.x = 0;
    this.aim.y = 0;
    this.turretYaw = 0;
    this.turretPitch = 0;
    this._updateOrientation();
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
      // visual easing toward aim
      towerGroup.rotation.z += (this.turretYaw - towerGroup.rotation.z) * blend;
    }
    if (towerHead){
      towerHead.rotation.x += (this.turretPitch - towerHead.rotation.x) * blend;
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
        if (wheel?.rotation){
          wheel.rotation.x -= rotationDelta;
        }
      });
    }
  }

  _updateOrientation(){
    TMP_EULER.set(0, this.lean, this.yaw, 'ZXY');
    this.orientation.setFromEuler(TMP_EULER);
  }

  update(dt, input = {}, extra = {}){
    const delta = Math.max(0, dt ?? 0);

    // inputs
    const steerInput = clamp(input.steer ?? 0, -1, 1);
    const throttleInput = clamp(input.throttle ?? 0, -1, 1);
    const brake = !!input.brake;

    if (input.aim){ this.setTurretAim(input.aim); }

    // throttle smoothing (throttle-based accel)
    this.targetThrottle = throttleInput;
    const throttleBlend = delta > 0 ? 1 - Math.exp(-this.throttleResponse * delta) : 1;
    this.throttle += (this.targetThrottle - this.throttle) * throttleBlend;

    // speed integration (drag/brake)
    const accel = this.throttle * this.acceleration;
    this.speed += accel * delta;
    this.speed -= this.drag * this.speed * delta;
    if (brake){
      this.speed -= this.brakeDeceleration * delta;
    }

    // clamp forward/reverse ranges
    this.speed = clamp(
      this.speed,
      -this.maxReverseSpeed,
      this.maxForwardSpeed
    );

    // steering smoothing w/ speed scaling
    this.currentSteer += (steerInput - this.currentSteer) * (delta > 0 ? 1 - Math.exp(-this.steeringResponse * delta) : 1);
    const speedFactor = clamp(Math.abs(this.speed) / Math.max(1, this.maxForwardSpeed), 0, 1);
    const steerScale = 0.35 + 0.65 * speedFactor;

    // yaw & lean
    this.yaw += this.currentSteer * this.steeringRate * steerScale * delta;
    this.lean += ((-this.currentSteer * speedFactor * 0.45) - this.lean) * (delta > 0 ? 1 - Math.exp(-this.leanResponse * delta) : 1);
    this._updateOrientation();

    // forward velocity
    this._tmpForward.copy(FORWARD_AXIS).applyQuaternion(this.orientation).normalize();
    this.velocity.copy(this._tmpForward).multiplyScalar(this.speed);
    this.position.addScaledVector(this.velocity, delta);

    // ground follow (z = ground + suspensionHeight)
    if (typeof extra.sampleGroundHeight === 'function'){
      const ground = extra.sampleGroundHeight(this.position.x, this.position.y);
      if (Number.isFinite(ground)){
        this.position.z = ground + this.suspensionHeight;
      }
    }

    // write to mesh
    if (this.mesh){
      this.mesh.position.copy(this.position);
      this.mesh.quaternion.copy(this.orientation);
    }

    // visuals
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
      yaw: this.yaw,
      lean: this.lean,
      aim: { x: this.aim.x, y: this.aim.y },
    };
  }
}

// ---------------------- createCarRig ----------------------
export function createCarRig(){
  // materials
  const bodyMaterial  = new THREE.MeshStandardMaterial({ color: 0x3a4a66, metalness: 0.4, roughness: 0.55 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: 0x85c8ff, metalness: 0.6, roughness: 0.4 });
  const glassMaterial = new THREE.MeshStandardMaterial({ color: 0xa3d1ff, metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.75 });
  const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x1f242b, metalness: 0.3, roughness: 0.8 });

  const car = new THREE.Group();
  car.name = 'TerraCar';

  // chassis
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 4.5), bodyMaterial);
  chassis.position.set(0, 0, 3.2);
  chassis.castShadow = true; chassis.receiveShadow = true;
  car.add(chassis);

  // canopy
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(6.5, 4.2, 2.6), glassMaterial);
  canopy.position.set(0, -0.4, 5.4);
  canopy.castShadow = true; canopy.receiveShadow = true;
  car.add(canopy);

  // wheels
  const wheelGeometry = new THREE.CylinderGeometry(1.6, 1.6, 1, 16);
  const wheelPositions = [
    [-4.8, 3.2, 1.6],
    [ 4.8, 3.2, 1.6],
    [-4.8,-3.2, 1.6],
    [ 4.8,-3.2, 1.6],
  ];
  const wheels = wheelPositions.map(([x, y, z]) => {
    const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, y, z);
    wheel.castShadow = true; wheel.receiveShadow = true;
    car.add(wheel);
    return wheel;
  });

  // turret group
  const towerGroup = new THREE.Group();
  towerGroup.position.set(0, 0, 7.6);
  car.add(towerGroup);

  const towerBase = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 1.4, 16), bodyMaterial);
  towerBase.position.set(0, 0, 0.7);
  towerBase.castShadow = true; towerBase.receiveShadow = true;
  towerGroup.add(towerBase);

  const towerHead = new THREE.Group();
  towerHead.position.set(0, 0, 2.2);
  towerGroup.add(towerHead);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 4.5, 12), accentMaterial);
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0, 2.2, 0);
  barrel.castShadow = true; barrel.receiveShadow = true;
  towerHead.add(barrel);

  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.9, 12), accentMaterial);
  muzzle.rotation.z = Math.PI / 2;
  muzzle.position.set(0, 4.8, 0);
  muzzle.castShadow = true; muzzle.receiveShadow = true;
  towerHead.add(muzzle);
  car.userData.turretMuzzle = muzzle;

  // control stick
  const stickBase = new THREE.Group();
  stickBase.position.set(0, -2.8, 4.4);
  car.add(stickBase);

  const stickYaw = new THREE.Group();
  stickBase.add(stickYaw);

  const stickPitch = new THREE.Group();
  stickPitch.position.set(0, 0, 1.4);
  stickYaw.add(stickPitch);

  const stickMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 2.6, 10), accentMaterial);
  stickMesh.position.set(0, 0, 1.3);
  stickMesh.castShadow = true; stickMesh.receiveShadow = true;
  stickPitch.add(stickMesh);

  return {
    carMesh: car,
    wheels,
    towerGroup,
    towerHead,
    stickYaw,
    stickPitch,
  };
}
