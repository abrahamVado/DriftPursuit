const THREE = (typeof window !== 'undefined' ? window.THREE : globalThis?.THREE) ?? null;
if (!THREE) throw new Error('Sandbox PlaneController requires THREE to be loaded globally');

const FORWARD_AXIS = new THREE.Vector3(0, 1, 0);
const TMP_VECTOR = new THREE.Vector3();
const TMP_EULER = new THREE.Euler(0, 0, 0, 'ZXY');

export class PlaneController {
  constructor({ position = new THREE.Vector3(), yaw = 0, pitch = 0, roll = 0 } = {}){
    this.position = position.clone();
    this.yaw = yaw;
    this.pitch = pitch;
    this.roll = roll;
    this.orientation = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.speed = 0;
    this.throttle = 0.5;
    this.targetThrottle = 0.5;
    this.minSpeed = 30;
    this.maxSpeed = 150;
    this.maxBoostSpeed = 220;
    this.acceleration = 45;
    this.throttleResponse = 1.8;
    this.turnRates = {
      yaw: THREE.MathUtils.degToRad(85),
      pitch: THREE.MathUtils.degToRad(110),
      roll: THREE.MathUtils.degToRad(160),
    };
    this.rollStability = 0.45;
    this.bankTurnFactor = THREE.MathUtils.degToRad(40);
    this.drag = 0.12;
    this.brakeDrag = 0.45;
    this.gravity = 9.8 * 0.6;
    this.altitude = 0;
    this._updateOrientation();
  }

  attachMesh(mesh){
    this.mesh = mesh;
    if (mesh){
      mesh.position.copy(this.position);
      mesh.quaternion.copy(this.orientation);
      if (!mesh.getObjectByName?.('leadTarget')){
        const targetGeometry = new THREE.SphereGeometry(0.45, 12, 12);
        const targetMaterial = new THREE.MeshBasicMaterial({ color: 0xffe26f, toneMapped: false });
        targetMaterial.depthTest = false;
        targetMaterial.depthWrite = false;
        const leadTarget = new THREE.Mesh(targetGeometry, targetMaterial);
        leadTarget.name = 'leadTarget';
        leadTarget.position.set(0, 10, 0);
        leadTarget.renderOrder = 2;
        mesh.add(leadTarget);
      }
    }
  }

  reset({ position, yaw = 0, pitch = 0, roll = 0, throttle = 0.35 } = {}){
    if (position){
      this.position.copy(position);
    }
    this.velocity.set(0, 0, 0);
    this.speed = this.minSpeed * 0.7;
    this.throttle = throttle;
    this.targetThrottle = throttle;
    this.yaw = yaw;
    this.pitch = pitch;
    this.roll = roll;
    this._updateOrientation();
    if (this.mesh){
      this.mesh.position.copy(this.position);
      this.mesh.quaternion.copy(this.orientation);
      const leadTarget = this.mesh.getObjectByName?.('leadTarget');
      if (leadTarget){
        leadTarget.position.set(0, 10, 0);
      }
    }
  }

  update(dt, input, { clampAltitude, sampleGroundHeight }){
    if (dt <= 0) return;
    if (!input) input = { pitch: 0, yaw: 0, roll: 0, throttleAdjust: 0, brake: false };

    this.targetThrottle = THREE.MathUtils.clamp(
      this.targetThrottle + input.throttleAdjust * dt * 0.8,
      0,
      1,
    );
    if (input.brake){
      this.targetThrottle = Math.min(this.targetThrottle, 0.2);
    }
    const throttleBlend = 1 - Math.exp(-this.throttleResponse * dt);
    this.throttle += (this.targetThrottle - this.throttle) * throttleBlend;
    this.throttle = THREE.MathUtils.clamp(this.throttle, 0, 1);

    const brakeApplied = input.brake ? this.brakeDrag : this.drag;
    const maxSpeed = this.minSpeed + (this.maxSpeed - this.minSpeed) * this.throttle;
    const boostSpeed = this.minSpeed + (this.maxBoostSpeed - this.minSpeed) * this.throttle;

    const speedTarget = THREE.MathUtils.lerp(maxSpeed, boostSpeed, Math.max(0, this.throttle - 0.85) * 4);
    const speedBlend = 1 - Math.exp(-this.acceleration * dt / Math.max(1, speedTarget));
    this.speed += (speedTarget - this.speed) * speedBlend;

    this.speed = Math.max(this.minSpeed * 0.3, this.speed);

    const yawInput = THREE.MathUtils.clamp(input.yaw, -1, 1);
    const pitchInput = THREE.MathUtils.clamp(input.pitch, -1, 1);
    const rollInput = THREE.MathUtils.clamp(input.roll, -1, 1);

    this.yaw += yawInput * this.turnRates.yaw * dt;
    this.pitch += pitchInput * this.turnRates.pitch * dt;
    this.pitch = THREE.MathUtils.clamp(this.pitch, THREE.MathUtils.degToRad(-70), THREE.MathUtils.degToRad(70));

    this.roll += rollInput * this.turnRates.roll * dt;
    this.roll -= this.roll * this.rollStability * dt;
    this.roll = THREE.MathUtils.clamp(this.roll, THREE.MathUtils.degToRad(-110), THREE.MathUtils.degToRad(110));

    const bankTurn = this.roll * this.bankTurnFactor * Math.min(1, this.speed / this.maxSpeed);
    this.yaw += bankTurn * dt;

    this._updateOrientation();

    const forward = TMP_VECTOR.copy(FORWARD_AXIS).applyQuaternion(this.orientation).normalize();
    const desiredVelocity = forward.multiplyScalar(this.speed);
    this.velocity.lerp(desiredVelocity, 1 - Math.exp(-3.5 * dt));

    const gravityVector = TMP_VECTOR.set(0, 0, -this.gravity * dt);
    this.velocity.add(gravityVector);
    this.velocity.multiplyScalar(Math.max(0, 1 - brakeApplied * dt));

    this.position.addScaledVector(this.velocity, dt);

    if (typeof sampleGroundHeight === 'function'){
      const ground = sampleGroundHeight(this.position.x, this.position.y);
      this.altitude = this.position.z - ground;
      if (typeof clampAltitude === 'function'){
        clampAltitude(this, ground);
      }
    }

    if (this.mesh){
      this.mesh.position.copy(this.position);
      this.mesh.quaternion.copy(this.orientation);
    }
  }

  getState(){
    return {
      position: this.position,
      velocity: this.velocity,
      orientation: this.orientation,
      speed: this.velocity.length(),
      throttle: this.throttle,
      altitude: this.altitude,
    };
  }

  _updateOrientation(){
    TMP_EULER.set(this.pitch, this.roll, this.yaw, 'ZXY');
    this.orientation.setFromEuler(TMP_EULER);
  }
}

export function createPlaneMesh(){
  const group = new THREE.Group();

  const fuselageMaterial = new THREE.MeshStandardMaterial({ color: 0xf0f3ff, metalness: 0.35, roughness: 0.45 });
  const noseMaterial = new THREE.MeshStandardMaterial({ color: 0xd13b4a, metalness: 0.4, roughness: 0.3 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: 0x2a4f9b, metalness: 0.45, roughness: 0.32 });

  const fuselageGeometry = new THREE.CapsuleGeometry(2.2, 12, 8, 16);
  const fuselage = new THREE.Mesh(fuselageGeometry, fuselageMaterial);
  fuselage.rotation.z = Math.PI / 2;
  fuselage.castShadow = true;
  fuselage.receiveShadow = true;
  group.add(fuselage);

  const noseGeometry = new THREE.ConeGeometry(2.2, 4.5, 14);
  const nose = new THREE.Mesh(noseGeometry, noseMaterial);
  nose.position.set(0, 9.3, 0);
  nose.rotation.x = Math.PI;
  nose.castShadow = true;
  group.add(nose);

  const tailGeometry = new THREE.ConeGeometry(1.4, 3.5, 10);
  const tail = new THREE.Mesh(tailGeometry, accentMaterial);
  tail.position.set(0, -7.8, 0);
  tail.castShadow = true;
  group.add(tail);

  const wingGeometry = new THREE.BoxGeometry(18, 3, 0.6);
  const wing = new THREE.Mesh(wingGeometry, accentMaterial);
  wing.position.set(0, 0.8, 0);
  wing.castShadow = true;
  wing.receiveShadow = true;
  group.add(wing);

  const tailWingGeometry = new THREE.BoxGeometry(8, 2.2, 0.45);
  const tailWing = new THREE.Mesh(tailWingGeometry, accentMaterial);
  tailWing.position.set(0, -6.5, 0.2);
  tailWing.castShadow = true;
  tailWing.receiveShadow = true;
  group.add(tailWing);

  const rudderGeometry = new THREE.BoxGeometry(0.6, 2.4, 4.2);
  const rudder = new THREE.Mesh(rudderGeometry, accentMaterial);
  rudder.position.set(0, -7.2, 2.1);
  rudder.castShadow = true;
  group.add(rudder);

  group.traverse((obj) => {
    if (obj.isMesh){
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  group.name = 'ArcadePlane';

  return group;
}
