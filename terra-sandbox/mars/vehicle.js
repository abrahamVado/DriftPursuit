import * as THREE from 'three';

const FORWARD = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 0, 1);
const TMP_VEC3 = new THREE.Vector3();
const TMP_QUAT = new THREE.Quaternion();
const TMP_EULER = new THREE.Euler();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class MarsVehicle {
  constructor({
    mass = 14,
    baseThrust = 120,
    boostMultiplier = 1.8,
    throttleRate = 1.6,
    throttleResponse = 4.2,
    angularRate = { pitch: THREE.MathUtils.degToRad(120), yaw: THREE.MathUtils.degToRad(90), roll: THREE.MathUtils.degToRad(150) },
    angularResponse = 6.5,
    drag = 0.12,
    lift = 0.9,
    hoverHeight = 24,
    hoverSpring = 4.6,
    hoverDamping = 2.2,
    weaponCooldown = 0.12,
    weaponHeatRise = 0.22,
    weaponHeatDrop = 0.55,
  } = {}) {
    this.mass = mass;
    this.baseThrust = baseThrust;
    this.boostMultiplier = boostMultiplier;
    this.throttleRate = throttleRate;
    this.throttleResponse = throttleResponse;
    this.angularRate = angularRate;
    this.angularResponse = angularResponse;
    this.drag = drag;
    this.lift = lift;
    this.hoverHeight = hoverHeight;
    this.hoverSpring = hoverSpring;
    this.hoverDamping = hoverDamping;
    this.weaponCooldownTime = weaponCooldown;
    this.weaponHeatRise = weaponHeatRise;
    this.weaponHeatDrop = weaponHeatDrop;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.orientation = new THREE.Quaternion();
    this.angularVelocity = new THREE.Vector3();
    this.mesh = null;
    this.attachments = {
      thrusterLeft: null,
      thrusterRight: null,
      thrusterCore: null,
      cockpitGlow: null,
    };

    this.targetThrottle = 0.4;
    this.throttle = 0.4;
    this.boosting = false;

    this.weaponCooldown = 0;
    this.weaponHeat = 0;

    this.sampleHeight = null;
  }

  setTerrainSampler(fn) {
    this.sampleHeight = fn;
  }

  attachMesh(mesh, attachments = {}) {
    this.mesh = mesh;
    this.attachments = {
      thrusterLeft: attachments.thrusterLeft ?? null,
      thrusterRight: attachments.thrusterRight ?? null,
      thrusterCore: attachments.thrusterCore ?? null,
      cockpitGlow: attachments.cockpitGlow ?? null,
    };
    if (this.mesh) {
      this.mesh.position.copy(this.position);
      this.mesh.quaternion.copy(this.orientation);
    }
  }

  reset({ position = new THREE.Vector3(0, 180, 120), orientation, velocity } = {}) {
    this.position.copy(position);
    if (orientation instanceof THREE.Quaternion) {
      this.orientation.copy(orientation);
    } else {
      this.orientation.setFromAxisAngle(UP, THREE.MathUtils.degToRad(180));
    }
    this.velocity.copy(velocity ?? new THREE.Vector3());
    this.angularVelocity.set(0, 0, 0);
    this.targetThrottle = 0.45;
    this.throttle = 0.45;
    this.boosting = false;
    this.weaponCooldown = 0;
    this.weaponHeat = 0;
    this._syncMesh();
  }

  update(dt, input = {}, environment = {}) {
    if (dt <= 0) return;
    const { gravity = 3.72 } = environment; // Mars gravity m/s^2

    this.targetThrottle = clamp(this.targetThrottle + (input.throttle ?? 0) * dt * this.throttleRate, 0, 1);
    if (input.brake) {
      this.targetThrottle = Math.max(0, this.targetThrottle - dt * this.throttleRate * 2.8);
    }
    const blend = 1 - Math.exp(-this.throttleResponse * dt);
    this.throttle += (this.targetThrottle - this.throttle) * blend;

    this.boosting = Boolean(input.boost) && this.throttle > 0.35;

    const forward = this.getForwardVector();
    const up = this.getUpVector();
    const right = this.getRightVector();

    const engineForce = this.baseThrust * this.throttle * (this.boosting ? this.boostMultiplier : 1);
    this.velocity.addScaledVector(forward, engineForce * dt / this.mass);

    const strafeInput = clamp(input.strafe ?? 0, -1, 1);
    if (Math.abs(strafeInput) > 0) {
      this.velocity.addScaledVector(right, strafeInput * this.baseThrust * 0.35 * dt / this.mass);
    }
    const elevateInput = clamp(input.elevate ?? 0, -1, 1);
    if (Math.abs(elevateInput) > 0) {
      this.velocity.addScaledVector(up, elevateInput * this.baseThrust * 0.3 * dt / this.mass);
    }

    // Drag in local space for stability
    const localVelocity = new THREE.Vector3(
      this.velocity.dot(right),
      this.velocity.dot(forward),
      this.velocity.dot(up),
    );
    localVelocity.x *= 1 - Math.min(1, this.drag * dt * 3.5);
    localVelocity.y *= 1 - Math.min(1, this.drag * dt);
    localVelocity.z *= 1 - Math.min(1, this.drag * dt * 2.2);
    this.velocity.copy(
      right.clone().multiplyScalar(localVelocity.x)
        .add(forward.clone().multiplyScalar(localVelocity.y))
        .add(up.clone().multiplyScalar(localVelocity.z)),
    );

    this.velocity.addScaledVector(up, this.lift * this.throttle * dt);
    this.velocity.addScaledVector(UP, -gravity * dt);

    // Hover spring to stay above terrain
    if (this.sampleHeight) {
      const ground = this.sampleHeight(this.position.x, this.position.z);
      const altitude = this.position.y - ground;
      const altitudeError = this.hoverHeight - altitude;
      const verticalVelocity = this.velocity.dot(UP);
      const correction = (altitudeError * this.hoverSpring - verticalVelocity * this.hoverDamping) * dt;
      this.velocity.addScaledVector(UP, correction);
    }

    // Angular dynamics
    const pitchInput = clamp(input.pitch ?? 0, -1, 1);
    const yawInput = clamp(input.yaw ?? 0, -1, 1);
    const rollInput = clamp(input.roll ?? 0, -1, 1);

    const angularBlend = 1 - Math.exp(-this.angularResponse * dt);
    this.angularVelocity.x += (pitchInput * this.angularRate.pitch - this.angularVelocity.x) * angularBlend;
    this.angularVelocity.y += (yawInput * this.angularRate.yaw - this.angularVelocity.y) * angularBlend;
    this.angularVelocity.z += (rollInput * this.angularRate.roll - this.angularVelocity.z) * angularBlend;

    TMP_EULER.set(
      this.angularVelocity.x * dt,
      this.angularVelocity.y * dt,
      this.angularVelocity.z * dt,
      'XYZ',
    );
    TMP_QUAT.setFromEuler(TMP_EULER);
    this.orientation.multiply(TMP_QUAT).normalize();

    this.position.addScaledVector(this.velocity, dt);

    if (this.sampleHeight) {
      const ground = this.sampleHeight(this.position.x, this.position.z);
      const minAltitude = ground + 6;
      if (this.position.y < minAltitude) {
        this.position.y = minAltitude;
        const vertical = this.velocity.dot(UP);
        if (vertical < 0) {
          this.velocity.addScaledVector(UP, -vertical);
        }
      }
    }

    this.weaponCooldown = Math.max(0, this.weaponCooldown - dt);
    this.weaponHeat = Math.max(0, this.weaponHeat - this.weaponHeatDrop * dt);

    this._updateThrusterVisuals();
    this._syncMesh();
  }

  firePrimary() {
    if (this.weaponCooldown > 0 || this.weaponHeat >= 1) {
      return null;
    }
    this.weaponCooldown = this.weaponCooldownTime;
    this.weaponHeat = clamp(this.weaponHeat + this.weaponHeatRise, 0, 1.2);

    const muzzle = this.getMuzzleWorldPosition();
    const direction = this.getForwardVector();
    const velocity = direction.clone().setLength(620).add(this.velocity);
    return { origin: muzzle, direction, velocity };
  }

  getForwardVector() {
    return FORWARD.clone().applyQuaternion(this.orientation);
  }

  getRightVector() {
    return RIGHT.clone().applyQuaternion(this.orientation);
  }

  getUpVector() {
    return UP.clone().applyQuaternion(this.orientation);
  }

  getSpeed() {
    return this.velocity.length();
  }

  getMuzzleWorldPosition() {
    const muzzleOffset = new THREE.Vector3(0, 10.5, 1.2);
    return TMP_VEC3.copy(muzzleOffset).applyQuaternion(this.orientation).add(this.position);
  }

  _syncMesh() {
    if (!this.mesh) return;
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.orientation);
  }

  _updateThrusterVisuals() {
    const intensity = clamp(this.throttle * (this.boosting ? 1.4 : 1), 0, 1.5);
    const heat = clamp(this.weaponHeat, 0, 1);
    const scaleBase = 0.8 + intensity * 1.6;
    const thrusterColor = new THREE.Color('#ff8347').lerp(new THREE.Color('#ffe5a3'), Math.min(1, this.boosting ? 1 : this.throttle));
    if (this.attachments.thrusterLeft) {
      this.attachments.thrusterLeft.scale.set(1, scaleBase, 1);
      if (this.attachments.thrusterLeft.material?.emissive) {
        this.attachments.thrusterLeft.material.emissive.copy(thrusterColor);
      }
    }
    if (this.attachments.thrusterRight) {
      this.attachments.thrusterRight.scale.set(1, scaleBase, 1);
      if (this.attachments.thrusterRight.material?.emissive) {
        this.attachments.thrusterRight.material.emissive.copy(thrusterColor);
      }
    }
    if (this.attachments.thrusterCore) {
      const coreScale = 0.6 + intensity * 1.2;
      this.attachments.thrusterCore.scale.set(coreScale, coreScale, coreScale);
      if (this.attachments.thrusterCore.material?.emissive) {
        this.attachments.thrusterCore.material.emissive.copy(thrusterColor);
      }
    }
    if (this.attachments.cockpitGlow && this.attachments.cockpitGlow.material?.emissive) {
      const cockpitColor = new THREE.Color('#54c9ff').lerp(new THREE.Color('#ffe89f'), heat);
      this.attachments.cockpitGlow.material.emissive.copy(cockpitColor);
    }
  }

  getState(sampleHeightFn) {
    const ground = sampleHeightFn ? sampleHeightFn(this.position.x, this.position.z) : 0;
    const altitude = this.position.y - ground;
    return {
      position: this.position.clone(),
      velocity: this.velocity.clone(),
      speed: this.getSpeed(),
      altitude,
      throttle: this.throttle,
      boost: this.boosting,
      weapon: {
        ready: this.weaponCooldown <= 0 && this.weaponHeat < 1,
        heat: clamp(this.weaponHeat, 0, 1),
      },
    };
  }
}

export function createMarsSkiff() {
  const group = new THREE.Group();
  group.name = 'marsSkiff';

  const hullMaterial = new THREE.MeshStandardMaterial({ color: '#f0d9c3', metalness: 0.25, roughness: 0.4 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: '#d3613f', metalness: 0.3, roughness: 0.32 });
  const wingMaterial = new THREE.MeshStandardMaterial({ color: '#803a28', metalness: 0.2, roughness: 0.5 });
  const glassMaterial = new THREE.MeshStandardMaterial({ color: '#6fd6ff', metalness: 0.6, roughness: 0.1, transparent: true, opacity: 0.65, emissive: '#54c9ff', emissiveIntensity: 0.9 });
  const thrusterMaterial = new THREE.MeshStandardMaterial({ color: '#ffb482', emissive: '#ff8442', emissiveIntensity: 1.2, roughness: 0.2, metalness: 0.1 });

  const fuselageGeometry = new THREE.CapsuleGeometry(2.4, 12, 12, 24);
  const fuselage = new THREE.Mesh(fuselageGeometry, hullMaterial);
  fuselage.rotation.z = Math.PI / 2;
  fuselage.castShadow = true;
  fuselage.receiveShadow = true;
  group.add(fuselage);

  const cockpitGeometry = new THREE.SphereGeometry(2.6, 18, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const cockpit = new THREE.Mesh(cockpitGeometry, glassMaterial);
  cockpit.position.set(0, 2.6, 1.6);
  cockpit.castShadow = true;
  group.add(cockpit);

  const intakeGeometry = new THREE.CylinderGeometry(1.6, 1.2, 1.4, 16, 1);
  const intake = new THREE.Mesh(intakeGeometry, accentMaterial);
  intake.rotation.x = Math.PI / 2;
  intake.position.set(0, 7.4, -0.2);
  intake.castShadow = true;
  group.add(intake);

  const wingGeometry = new THREE.BoxGeometry(16, 3, 0.6);
  const wing = new THREE.Mesh(wingGeometry, wingMaterial);
  wing.position.set(0, -0.6, -0.3);
  wing.castShadow = true;
  wing.receiveShadow = true;
  group.add(wing);

  const stabilizerGeometry = new THREE.BoxGeometry(8, 2, 0.5);
  const stabilizer = new THREE.Mesh(stabilizerGeometry, wingMaterial);
  stabilizer.position.set(0, -6.8, 0.8);
  stabilizer.castShadow = true;
  stabilizer.receiveShadow = true;
  group.add(stabilizer);

  const finGeometry = new THREE.BoxGeometry(0.6, 2.6, 4.2);
  const fin = new THREE.Mesh(finGeometry, accentMaterial);
  fin.position.set(0, -7.2, 2.6);
  fin.castShadow = true;
  group.add(fin);

  const thrusterLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 2.6, 12), thrusterMaterial.clone());
  thrusterLeft.rotation.x = Math.PI / 2;
  thrusterLeft.position.set(-3.8, -5.2, -0.2);
  group.add(thrusterLeft);

  const thrusterRight = thrusterLeft.clone();
  thrusterRight.position.x *= -1;
  group.add(thrusterRight);

  const thrusterCoreGeometry = new THREE.SphereGeometry(1.1, 14, 12);
  const thrusterCore = new THREE.Mesh(thrusterCoreGeometry, thrusterMaterial.clone());
  thrusterCore.position.set(0, -7.4, -0.4);
  group.add(thrusterCore);

  const cannonGeometry = new THREE.CylinderGeometry(0.35, 0.35, 8.5, 10);
  const cannon = new THREE.Mesh(cannonGeometry, accentMaterial);
  cannon.rotation.x = Math.PI / 2;
  cannon.position.set(0, 8.2, -1);
  cannon.castShadow = true;
  group.add(cannon);

  return {
    group,
    attachments: {
      thrusterLeft,
      thrusterRight,
      thrusterCore,
      cockpitGlow: cockpit,
    },
  };
}
