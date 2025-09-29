const THREE = (typeof window !== 'undefined' ? window.THREE : globalThis?.THREE) ?? null;
if (!THREE) throw new Error('Sandbox CarController requires THREE to be loaded globally');

const FORWARD_AXIS = new THREE.Vector3(0, 1, 0);
const TMP_FORWARD = new THREE.Vector3();
const TMP_EULER = new THREE.Euler(0, 0, 0, 'ZXY');

export class CarController {
  constructor({ position = new THREE.Vector3(), yaw = 0 } = {}) {
    this.position = position.clone();
    this.yaw = yaw;
    this.lean = 0;
    this.velocity = new THREE.Vector3();
    this.orientation = new THREE.Quaternion();
    this.speed = 0;
    this.maxForwardSpeed = 62;
    this.maxReverseSpeed = 26;
    this.speedResponse = 4.2;
    this.brakeStrength = 7.5;
    this.drag = 1.8;
    this.turnRate = THREE.MathUtils.degToRad(75);
    this.turnSmoothing = 8.5;
    this.leanResponse = 6.5;
    this.height = 2.1;
    this.armYaw = 0;
    this.armPitch = 0;
    this.armYawLimit = THREE.MathUtils.degToRad(75);
    this.armPitchLimit = THREE.MathUtils.degToRad(48);
    this.armResponse = 10;
    this.currentSteer = 0;
    this.power = 0;
    this.wheelRotation = 0;
    this._updateOrientation();
  }

  attachMesh(mesh, { stickYaw, stickPitch, towerGroup, towerHead, wheels = [] } = {}) {
    this.mesh = mesh ?? null;
    this.stickYaw = stickYaw ?? null;
    this.stickPitch = stickPitch ?? null;
    this.towerGroup = towerGroup ?? null;
    this.towerHead = towerHead ?? null;
    this.wheels = Array.isArray(wheels) ? wheels : [];
    if (mesh) {
      mesh.position.copy(this.position);
      mesh.quaternion.copy(this.orientation);
    }
  }

  reset({ position, yaw = 0 } = {}) {
    if (position) {
      this.position.copy(position);
    }
    this.yaw = yaw;
    this.lean = 0;
    this.speed = 0;
    this.velocity.set(0, 0, 0);
    this.currentSteer = 0;
    this.power = 0;
    this.wheelRotation = 0;
    this.armYaw = 0;
    this.armPitch = 0;
    this._updateOrientation();
    if (this.mesh) {
      this.mesh.position.copy(this.position);
      this.mesh.quaternion.copy(this.orientation);
    }
    this._applyManipulator({ x: 0, y: 0 }, 1);
  }

  update(dt, input = {}, { sampleGroundHeight } = {}) {
    if (dt <= 0) return;

    const throttleInput = THREE.MathUtils.clamp(input.throttle ?? 0, -1, 1);
    const steerInput = THREE.MathUtils.clamp(input.steer ?? 0, -1, 1);
    const brake = !!input.brake;

    const forwardTarget = throttleInput >= 0
      ? throttleInput * this.maxForwardSpeed
      : throttleInput * this.maxReverseSpeed;

    const blend = dt > 0 ? 1 - Math.exp(-this.speedResponse * dt) : 1;
    this.speed += (forwardTarget - this.speed) * blend;

    if (brake) {
      const brakeFactor = 1 - Math.exp(-this.brakeStrength * dt);
      this.speed += (0 - this.speed) * brakeFactor;
    } else if (Math.abs(throttleInput) < 0.05) {
      const dragFactor = 1 - Math.exp(-this.drag * dt);
      this.speed += (0 - this.speed) * dragFactor;
    }

    this.power = Math.max(0, Math.min(1, Math.abs(throttleInput)));

    this.currentSteer += (steerInput - this.currentSteer) * (dt > 0 ? 1 - Math.exp(-this.turnSmoothing * dt) : 1);
    const speedFactor = Math.min(1, Math.abs(this.speed) / this.maxForwardSpeed);
    this.yaw += this.currentSteer * this.turnRate * dt * (0.35 + speedFactor * 0.65);

    this.lean += ((-this.currentSteer * speedFactor * 0.45) - this.lean) * (dt > 0 ? 1 - Math.exp(-this.leanResponse * dt) : 1);

    this._updateOrientation();
    const forward = TMP_FORWARD.copy(FORWARD_AXIS).applyQuaternion(this.orientation).normalize();
    this.velocity.copy(forward).multiplyScalar(this.speed);
    this.position.addScaledVector(this.velocity, dt);

    if (typeof sampleGroundHeight === 'function') {
      const ground = sampleGroundHeight(this.position.x, this.position.y);
      if (Number.isFinite(ground)) {
        this.position.z = ground + this.height;
      }
    }

    this._applyManipulator(input.aim ?? { x: 0, y: 0 }, dt);
    this._updateWheels(dt);

    if (this.mesh) {
      this.mesh.position.copy(this.position);
      this.mesh.quaternion.copy(this.orientation);
    }
  }

  getState() {
    return {
      position: this.position,
      orientation: this.orientation,
      velocity: this.velocity,
      speed: Math.abs(this.velocity.length()),
      throttle: this.power,
    };
  }

  _updateOrientation() {
    TMP_EULER.set(0, this.lean, this.yaw, 'ZXY');
    this.orientation.setFromEuler(TMP_EULER);
  }

  _applyManipulator(aim, dt) {
    if (!aim) aim = { x: 0, y: 0 };
    const targetYaw = THREE.MathUtils.clamp(aim.x ?? 0, -1, 1) * this.armYawLimit;
    const targetPitch = THREE.MathUtils.clamp(aim.y ?? 0, -1, 1) * this.armPitchLimit;

    const blend = dt > 0 ? 1 - Math.exp(-this.armResponse * dt) : 1;
    this.armYaw += (targetYaw - this.armYaw) * blend;
    this.armPitch += (targetPitch - this.armPitch) * blend;

    if (this.stickYaw) {
      this.stickYaw.rotation.z = this.armYaw;
    }
    if (this.stickPitch) {
      this.stickPitch.rotation.x = this.armPitch;
    }
    if (this.towerGroup) {
      this.towerGroup.rotation.x += (this.armPitch * 0.5 - this.towerGroup.rotation.x) * blend;
      this.towerGroup.rotation.z += (this.armYaw * 0.5 - this.towerGroup.rotation.z) * blend;
    }
    if (this.towerHead) {
      this.towerHead.rotation.x += (-this.armPitch * 0.8 - this.towerHead.rotation.x) * blend;
      this.towerHead.rotation.z += (this.armYaw * 0.8 - this.towerHead.rotation.z) * blend;
    }
  }

  _updateWheels(dt) {
    if (!Array.isArray(this.wheels) || this.wheels.length === 0) return;
    const wheelRadius = 1.05;
    this.wheelRotation += (this.speed * dt) / Math.max(0.2, wheelRadius);
    for (const wheel of this.wheels) {
      if (!wheel) continue;
      wheel.rotation.x = this.wheelRotation;
    }
  }
}

export function createCarRig() {
  const carGroup = new THREE.Group();
  carGroup.name = 'groundCar';

  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x253347, metalness: 0.2, roughness: 0.5 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: 0xff6b3d, metalness: 0.35, roughness: 0.35 });
  const glassMaterial = new THREE.MeshStandardMaterial({ color: 0xa3d1ff, metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.75 });
  const stickMaterial = new THREE.MeshStandardMaterial({ color: 0xe8d37a, metalness: 0.15, roughness: 0.45 });
  const towerMaterial = new THREE.MeshStandardMaterial({ color: 0x445c7a, metalness: 0.25, roughness: 0.4 });

  const chassisGeometry = new THREE.BoxGeometry(9, 5.5, 2.4);
  const chassis = new THREE.Mesh(chassisGeometry, bodyMaterial);
  chassis.position.set(0, 0, 2.1);
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  carGroup.add(chassis);

  const cabinGeometry = new THREE.BoxGeometry(5.8, 3.6, 2.2);
  const cabin = new THREE.Mesh(cabinGeometry, glassMaterial);
  cabin.position.set(0, -0.3, 3.3);
  cabin.castShadow = true;
  carGroup.add(cabin);

  const hoodGeometry = new THREE.BoxGeometry(6.2, 2.4, 1.2);
  const hood = new THREE.Mesh(hoodGeometry, accentMaterial);
  hood.position.set(0, 3.4, 2.5);
  hood.castShadow = true;
  carGroup.add(hood);

  const bumperGeometry = new THREE.BoxGeometry(9.2, 0.8, 1);
  const bumper = new THREE.Mesh(bumperGeometry, accentMaterial);
  bumper.position.set(0, 5, 1.8);
  bumper.castShadow = true;
  carGroup.add(bumper);

  const wheelGeometry = new THREE.CylinderGeometry(1.05, 1.05, 0.8, 20);
  const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.35, roughness: 0.7 });
  const wheelOffsets = [
    [2.8, 3.4, 1.05],
    [-2.8, 3.4, 1.05],
    [2.8, -3.4, 1.05],
    [-2.8, -3.4, 1.05],
  ];
  const wheels = [];
  for (const [x, y, z] of wheelOffsets) {
    const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, y, z);
    wheel.castShadow = true;
    wheel.receiveShadow = true;
    carGroup.add(wheel);
    wheels.push(wheel);
  }

  const stickYaw = new THREE.Group();
  stickYaw.position.set(0, 2.8, 4.1);
  carGroup.add(stickYaw);

  const stickPitch = new THREE.Group();
  stickYaw.add(stickPitch);

  const stickGeometry = new THREE.CylinderGeometry(0.18, 0.22, 6.2, 12);
  const stick = new THREE.Mesh(stickGeometry, stickMaterial);
  stick.position.set(0, 3.1, 0);
  stick.castShadow = true;
  stickPitch.add(stick);

  const stickTip = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 12), accentMaterial);
  stickTip.position.set(0, 3.4, 0);
  stickTip.castShadow = true;
  stickPitch.add(stickTip);

  const towerGroup = new THREE.Group();
  towerGroup.position.set(0, 7.4, 0);
  carGroup.add(towerGroup);

  const towerBaseGeometry = new THREE.CylinderGeometry(1.4, 1.8, 1.2, 16);
  const towerBase = new THREE.Mesh(towerBaseGeometry, towerMaterial);
  towerBase.position.set(0, 0, 0.6);
  towerBase.castShadow = true;
  towerBase.receiveShadow = true;
  towerGroup.add(towerBase);

  const towerColumnGeometry = new THREE.CylinderGeometry(0.75, 0.75, 5.6, 18);
  const towerColumn = new THREE.Mesh(towerColumnGeometry, towerMaterial);
  towerColumn.position.set(0, 0, 3.7);
  towerColumn.castShadow = true;
  towerColumn.receiveShadow = true;
  towerGroup.add(towerColumn);

  const towerHead = new THREE.Group();
  towerHead.position.set(0, 0, 6.8);
  towerGroup.add(towerHead);

  const towerCrossGeometry = new THREE.BoxGeometry(0.6, 3.8, 0.6);
  const towerCross = new THREE.Mesh(towerCrossGeometry, accentMaterial);
  towerCross.castShadow = true;
  towerHead.add(towerCross);

  const towerStickGeometry = new THREE.CylinderGeometry(0.16, 0.16, 5.4, 12);
  const towerStick = new THREE.Mesh(towerStickGeometry, stickMaterial);
  towerStick.rotation.x = Math.PI / 2;
  towerStick.position.set(0, 0, -0.3);
  towerStick.castShadow = true;
  towerHead.add(towerStick);

  const towerBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 3.6, 14), accentMaterial);
  towerBarrel.rotation.x = Math.PI / 2;
  towerBarrel.position.set(0, 1.8, 0);
  towerBarrel.castShadow = true;
  towerHead.add(towerBarrel);

  const towerMuzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.9, 12), new THREE.MeshStandardMaterial({ color: 0xffe070, emissive: 0xffa040, emissiveIntensity: 0.65 }));
  towerMuzzle.rotation.x = Math.PI / 2;
  towerMuzzle.position.set(0, 3.4, 0);
  towerMuzzle.castShadow = true;
  towerHead.add(towerMuzzle);

  const towerOrb = new THREE.Mesh(new THREE.SphereGeometry(0.55, 18, 14), new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffc860, emissiveIntensity: 0.4 }));
  towerOrb.position.set(0, 0, 0.7);
  towerOrb.castShadow = true;
  towerHead.add(towerOrb);

  carGroup.updateMatrixWorld(true);
  const boundingBox = new THREE.Box3().setFromObject(carGroup);
  const boundingSphere = boundingBox.getBoundingSphere(new THREE.Sphere());
  carGroup.userData.boundingCenter = boundingSphere.center.clone();
  carGroup.userData.boundingRadius = boundingSphere.radius;
  carGroup.userData.turretMuzzle = towerMuzzle;

  return {
    carMesh: carGroup,
    wheels,
    stickYaw,
    stickPitch,
    towerGroup,
    towerHead,
  };
}
