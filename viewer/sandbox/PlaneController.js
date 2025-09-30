const THREE = (typeof window !== 'undefined' ? window.THREE : globalThis?.THREE) ?? null;
if (!THREE) throw new Error('Sandbox PlaneController requires THREE to be loaded globally');

const FORWARD_AXIS = new THREE.Vector3(0, 1, 0);
const TMP_VECTOR = new THREE.Vector3();
const TMP_VECTOR2 = new THREE.Vector3();
const TMP_VECTOR3 = new THREE.Vector3();
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
    this.maxSpeed = 190;
    this.maxBoostSpeed = 320;
    this.acceleration = 55;
    this.afterburnerAcceleration = 90;
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
    this.propulsorLift = this.gravity * 1.05;
    this.propulsorThrust = 32;
    this.propulsorResponse = 6.2;
    this.propulsorHeat = 0;
    this.propulsorRefs = [];
    this.altitude = 0;
    this._updateOrientation();
  }

  attachMesh(mesh){
    this.mesh = mesh;
    this.propulsorRefs = Array.isArray(mesh?.userData?.propulsors) ? mesh.userData.propulsors : [];
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
      this._applyPropulsorIntensity(this.propulsorHeat);
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
    this.propulsorHeat = this.throttle;
    this._applyPropulsorIntensity(this.propulsorHeat);
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
    const throttleBoost = THREE.MathUtils.clamp((this.throttle - 0.55) / 0.45, 0, 1);
    const boostFactor = throttleBoost * throttleBoost;
    const baseSpeed = this.minSpeed + (this.maxSpeed - this.minSpeed) * this.throttle;
    const speedTarget = THREE.MathUtils.lerp(baseSpeed, this.maxBoostSpeed, boostFactor);
    const accelRate = this.acceleration + this.afterburnerAcceleration * boostFactor;
    const speedBlend = 1 - Math.exp(-accelRate * dt / Math.max(1, speedTarget));
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
    const desiredVelocity = TMP_VECTOR2.copy(forward).multiplyScalar(this.speed);
    this.velocity.lerp(desiredVelocity, 1 - Math.exp(-3.5 * dt));

    if (boostFactor > 0){
      const climbFactor = Math.max(0.12, forward.z + 0.12);
      const thrust = this.propulsorThrust * boostFactor * climbFactor;
      this.velocity.addScaledVector(forward, thrust * dt);
    }

    const lift = this.propulsorLift * boostFactor;
    const effectiveGravity = Math.max(0, this.gravity - lift);
    const gravityVector = TMP_VECTOR3.set(0, 0, -effectiveGravity * dt);
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

    this._updatePropulsors(dt, Math.max(this.throttle, boostFactor));
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

  _updatePropulsors(dt, targetIntensity = this.throttle){
    const blend = dt > 0 ? 1 - Math.exp(-this.propulsorResponse * dt) : 1;
    const clampedTarget = THREE.MathUtils.clamp(targetIntensity, 0, 1);
    this.propulsorHeat += (clampedTarget - this.propulsorHeat) * blend;
    this.propulsorHeat = THREE.MathUtils.clamp(this.propulsorHeat, 0, 1);
    this._applyPropulsorIntensity(this.propulsorHeat);
  }

  _applyPropulsorIntensity(level){
    if (!this.propulsorRefs || this.propulsorRefs.length === 0) return;
    const intensity = THREE.MathUtils.clamp(level ?? 0, 0, 1);
    for (const propulsor of this.propulsorRefs){
      if (!propulsor) continue;
      if (propulsor.light){
        const min = propulsor.minIntensity ?? 0.25;
        const max = propulsor.maxIntensity ?? 2.8;
        propulsor.light.intensity = THREE.MathUtils.lerp(min, max, intensity);
        if (propulsor.light.shadow){
          propulsor.light.shadow.needsUpdate = true;
        }
      }
      if (propulsor.glowMaterial){
        const minOpacity = propulsor.minOpacity ?? 0.08;
        const maxOpacity = propulsor.maxOpacity ?? 0.9;
        propulsor.glowMaterial.opacity = intensity <= 0.001
          ? 0
          : THREE.MathUtils.lerp(minOpacity, maxOpacity, intensity);
      }
      if (propulsor.glowMesh){
        const minScale = propulsor.minScale ?? 0.7;
        const maxScale = propulsor.maxScale ?? 1.65;
        const scale = THREE.MathUtils.lerp(minScale, maxScale, intensity);
        const scaleZ = propulsor.scaleZ ?? 1.6;
        propulsor.glowMesh.scale.set(scale, scale, scale * scaleZ);
      }
      if (propulsor.housingMaterial && typeof propulsor.housingMaterial.emissiveIntensity === 'number'){
        const minEmissive = propulsor.minEmissive ?? 0.05;
        const maxEmissive = propulsor.maxEmissive ?? 0.45;
        propulsor.housingMaterial.emissiveIntensity = THREE.MathUtils.lerp(minEmissive, maxEmissive, intensity);
      }
    }
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

  const propulsorHousingMaterial = new THREE.MeshStandardMaterial({
    color: 0x314166,
    metalness: 0.78,
    roughness: 0.28,
    emissive: 0x121c33,
    emissiveIntensity: 0.08,
  });
  const baseGlowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffa86a,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });

  const propulsorOffsets = [
    new THREE.Vector3(-4.4, -5.1, -0.5),
    new THREE.Vector3(4.4, -5.1, -0.5),
    new THREE.Vector3(0, -8.4, -0.2),
  ];
  const propulsors = [];

  propulsorOffsets.forEach((offset, index) => {
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.2, 3, 18, 1, true), propulsorHousingMaterial.clone());
    housing.rotation.x = Math.PI / 2;
    housing.position.copy(offset);
    housing.castShadow = true;
    housing.receiveShadow = true;
    group.add(housing);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.12, 12, 20), accentMaterial);
    rim.position.copy(offset);
    rim.rotation.y = Math.PI / 2;
    rim.castShadow = true;
    group.add(rim);

    const glowMaterial = baseGlowMaterial.clone();
    const glow = new THREE.Mesh(new THREE.ConeGeometry(0.95, 4.2, 20, 1, true), glowMaterial);
    glow.position.copy(offset);
    glow.position.y -= index === 2 ? 2.6 : 2.2;
    glow.rotation.x = Math.PI;
    glow.renderOrder = 3;
    glow.scale.set(0.8, 0.8, index === 2 ? 1.8 : 1.5);
    group.add(glow);

    const light = new THREE.PointLight(0xffb978, 0, index === 2 ? 120 : 80, 2.8);
    light.position.copy(offset);
    light.position.y -= index === 2 ? 1.2 : 0.8;
    group.add(light);

    propulsors.push({
      light,
      glowMesh: glow,
      glowMaterial,
      housingMaterial: housing.material,
      minIntensity: 0.35,
      maxIntensity: index === 2 ? 3.8 : 2.9,
      minOpacity: 0.12,
      maxOpacity: 0.95,
      minScale: 0.75,
      maxScale: index === 2 ? 1.8 : 1.55,
      scaleZ: index === 2 ? 2.2 : 1.6,
      minEmissive: 0.08,
      maxEmissive: index === 2 ? 0.7 : 0.5,
    });
  });

  group.traverse((obj) => {
    if (obj.isMesh){
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  group.name = 'ArcadePlane';
  group.userData.propulsors = propulsors;

  return group;
}
