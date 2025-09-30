import { requireTHREE } from '../shared/threeSetup.js';

const THREE = requireTHREE();

const DEFAULT_CONFIG = Object.freeze({
  maxSpeed: 9600,
  minSpeed: 0,
  acceleration: 1.8,
  velocityResponsiveness: 4.5,
  brakeDeceleration: 6200,
  throttleResponsiveness: 1.6,
  turnRates: {
    yaw: THREE.MathUtils.degToRad(55),
    pitch: THREE.MathUtils.degToRad(48),
    roll: THREE.MathUtils.degToRad(65),
  },
});

const TMP_EULER = new THREE.Euler();
const TMP_QUAT = new THREE.Quaternion();
const TMP_FORWARD = new THREE.Vector3();
const TMP_UP = new THREE.Vector3(0, 0, 1);
const TMP_TARGET = new THREE.Vector3();

function createShipMesh(){
  const group = new THREE.Group();
  group.name = 'OrbitalPlayerShip';

  const hullMaterial = new THREE.MeshStandardMaterial({ color: 0xdde3ff, metalness: 0.38, roughness: 0.35 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: 0x4c5ea6, metalness: 0.32, roughness: 0.28 });
  const glowMaterial = new THREE.MeshStandardMaterial({ color: 0xffa04a, emissive: 0xff7a1f, emissiveIntensity: 0.85, metalness: 0.08, roughness: 0.6 });

  const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(6, 36, 12, 24), hullMaterial);
  fuselage.rotation.z = Math.PI / 2;
  fuselage.castShadow = true;
  fuselage.receiveShadow = true;
  group.add(fuselage);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(6, 16, 20), accentMaterial);
  nose.position.set(0, 28, 0);
  nose.rotation.x = Math.PI;
  nose.castShadow = true;
  group.add(nose);

  const tail = new THREE.Mesh(new THREE.ConeGeometry(4.2, 18, 16), accentMaterial);
  tail.position.set(0, -28, 0);
  tail.castShadow = true;
  group.add(tail);

  const wingGeometry = new THREE.BoxGeometry(42, 4.2, 2.2);
  const wing = new THREE.Mesh(wingGeometry, accentMaterial);
  wing.position.set(0, 0, 0);
  wing.castShadow = true;
  wing.receiveShadow = true;
  group.add(wing);

  const tailWingGeometry = new THREE.BoxGeometry(16, 3.2, 1.4);
  const tailWing = new THREE.Mesh(tailWingGeometry, accentMaterial);
  tailWing.position.set(0, -18, 0);
  tailWing.castShadow = true;
  tailWing.receiveShadow = true;
  group.add(tailWing);

  const thruster = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 5.4, 6, 16, 1, true), glowMaterial);
  thruster.position.set(0, -32, 0);
  thruster.rotation.x = Math.PI / 2;
  group.add(thruster);

  const glow = new THREE.PointLight(0xff8d3a, 1.6, 420, 2.2);
  glow.position.set(0, -34, 0);
  group.add(glow);

  group.scale.setScalar(2.4);
  group.castShadow = true;
  group.receiveShadow = true;

  return group;
}

export class OrbitalPlayerShip {
  constructor({ scene = null, config = {} } = {}){
    this.scene = scene;
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      turnRates: { ...DEFAULT_CONFIG.turnRates, ...(config.turnRates ?? {}) },
    };

    this.mesh = createShipMesh();
    if (this.scene){
      this.scene.add(this.mesh);
    }

    this.orientation = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 1, 0);
    this.up = new THREE.Vector3(0, 0, 1);

    this.state = {
      position: this.mesh.position,
      orientation: this.orientation,
      velocity: this.velocity,
      forward: this.forward,
      up: this.up,
    };

    this.active = true;
    this.visible = true;
    this.throttle = 0;
    this.speed = 0;
    this.hasLaunched = false;
    this._needsMatrixUpdate = true;
  }

  dispose(){
    if (this.scene && this.mesh){
      this.scene.remove(this.mesh);
    }
    this.mesh.traverse?.((child) => {
      if (child.isMesh){
        child.geometry?.dispose?.();
        child.material?.dispose?.();
      }
    });
  }

  setActive(active){
    this.active = Boolean(active);
  }

  setVisible(visible){
    this.visible = Boolean(visible);
    this.mesh.visible = this.visible;
  }

  resetFlight(){
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.throttle = 0;
    this.hasLaunched = false;
  }

  setPosition(position, { keepVelocity = false } = {}){
    if (!position) return;
    this.mesh.position.copy(position);
    if (!keepVelocity){
      this.resetFlight();
    }
    this._needsMatrixUpdate = true;
  }

  setOrientation(quaternion){
    if (!quaternion) return;
    this.orientation.copy(quaternion).normalize();
    this.mesh.quaternion.copy(this.orientation);
    this._needsMatrixUpdate = true;
  }

  lookTowards(target, { up = TMP_UP } = {}){
    if (!target) return;
    TMP_TARGET.copy(target).sub(this.mesh.position);
    if (TMP_TARGET.lengthSq() < 1e-6){
      return;
    }
    TMP_TARGET.normalize();
    const from = TMP_FORWARD.set(0, 1, 0);
    const lookQuat = TMP_QUAT.setFromUnitVectors(from, TMP_TARGET);
    this.orientation.copy(lookQuat);
    if (up){
      this.alignUp(up);
    }
    this.mesh.quaternion.copy(this.orientation);
    this._needsMatrixUpdate = true;
  }

  alignUp(upVector){
    if (!upVector) return;
    TMP_UP.copy(upVector).normalize();
    const currentUp = this.getUpVector(new THREE.Vector3());
    if (currentUp.lengthSq() < 1e-6){
      return;
    }
    const desiredUp = TMP_UP;
    const correction = TMP_QUAT.setFromUnitVectors(currentUp, desiredUp);
    this.orientation.premultiply(correction);
    this.orientation.normalize();
    this.mesh.quaternion.copy(this.orientation);
    this._needsMatrixUpdate = true;
  }

  getPosition(target = new THREE.Vector3()){
    return target.copy(this.mesh.position);
  }

  getForwardVector(target = new THREE.Vector3()){
    target.set(0, 1, 0);
    return target.applyQuaternion(this.orientation).normalize();
  }

  getUpVector(target = new THREE.Vector3()){
    target.set(0, 0, 1);
    return target.applyQuaternion(this.orientation).normalize();
  }

  getState(){
    return this.state;
  }

  update(dt = 0, input = {}, { drag = 0.0025 } = {}){
    if (!this.active){
      return this.state;
    }

    const { turnRates } = this.config;
    const yawInput = input?.yaw ?? 0;
    const pitchInput = input?.pitch ?? 0;
    const rollInput = input?.roll ?? 0;

    const yawDelta = turnRates.yaw * yawInput * dt;
    const pitchDelta = turnRates.pitch * pitchInput * dt;
    const rollDelta = turnRates.roll * rollInput * dt;

    if (yawDelta || pitchDelta || rollDelta){
      TMP_EULER.set(pitchDelta, yawDelta, -rollDelta, 'XYZ');
      TMP_QUAT.setFromEuler(TMP_EULER);
      this.orientation.multiply(TMP_QUAT).normalize();
      this.mesh.quaternion.copy(this.orientation);
      this._needsMatrixUpdate = true;
    }

    const throttleAdjust = input?.throttleAdjust ?? 0;
    if (Number.isFinite(throttleAdjust) && throttleAdjust !== 0){
      const rate = this.config.throttleResponsiveness * dt;
      this.throttle = THREE.MathUtils.clamp(this.throttle + throttleAdjust * rate, 0, 1);
    }

    if (input?.brake){
      this.speed = Math.max(0, this.speed - this.config.brakeDeceleration * dt);
      this.throttle = Math.max(0, this.throttle - 1.4 * dt);
    }

    const desiredSpeed = THREE.MathUtils.clamp(
      this.config.minSpeed + (this.config.maxSpeed - this.config.minSpeed) * this.throttle,
      this.config.minSpeed,
      this.config.maxSpeed,
    );
    const accelBlend = dt > 0 ? 1 - Math.exp(-this.config.acceleration * dt) : 1;
    this.speed += (desiredSpeed - this.speed) * accelBlend;
    if (this.speed < 0.5){
      this.speed = 0;
    }

    const forward = this.getForwardVector(this.forward);
    const desiredVelocity = TMP_FORWARD.copy(forward).multiplyScalar(this.speed);
    const velocityBlend = dt > 0 ? 1 - Math.exp(-this.config.velocityResponsiveness * dt) : 1;
    this.velocity.lerp(desiredVelocity, velocityBlend);

    if (drag > 0){
      const damping = Math.max(0, 1 - drag * dt * 60);
      this.velocity.multiplyScalar(damping);
    }

    this.mesh.position.addScaledVector(this.velocity, dt);

    if (this.speed > 5){
      this.hasLaunched = true;
    }

    if (this._needsMatrixUpdate){
      this.mesh.updateMatrixWorld?.();
      this._needsMatrixUpdate = false;
    }

    this.up.copy(this.getUpVector(this.up));

    return this.state;
  }
}

export default OrbitalPlayerShip;
