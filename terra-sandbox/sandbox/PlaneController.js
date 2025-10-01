// PlaneController.js (merged & polished)

import THREE from '../shared/threeProxy.js';

if (!THREE) throw new Error('PlaneController requires THREE to be loaded globally');

// Axes & temps
const FORWARD_AXIS = new THREE.Vector3(0, 1, 0);
const TMP_VECTOR  = new THREE.Vector3();
const TMP_VECTOR2 = new THREE.Vector3();
const TMP_VECTOR3 = new THREE.Vector3();
const TMP_EULER   = new THREE.Euler(0, 0, 0, 'ZXY');

export class PlaneController {
  constructor({
    // Pose
    position = new THREE.Vector3(),
    yaw = 0, pitch = 0, roll = 0,

    // Throttle / speed model
    minSpeed = 30,
    maxSpeed = 190,
    maxBoostSpeed = 320,
    acceleration = 55,
    afterburnerAcceleration = 90,
    throttleResponse = 1.8,

    // Turning & stability
    turnRates = {
      yaw:   THREE.MathUtils.degToRad(85),
      pitch: THREE.MathUtils.degToRad(110),
      roll:  THREE.MathUtils.degToRad(160),
    },
    rollStability = 0.45,
    bankTurnFactor = THREE.MathUtils.degToRad(40),

    // Forces
    drag = 0.12,
    brakeDrag = 0.45,
    gravity = 9.8 * 0.6,
    propulsorLift = (9.8 * 0.6) * 1.05, // a bit more than gravity at full boost
    propulsorThrust = 32,
    propulsorResponse = 6.2,
    maxThrottle = 1,
    unlimitedPropulsion = false,
    unlimitedPropulsionGain = undefined,
  } = {}){
    // Kinematics
    this.position = position.clone();
    this.velocity = new THREE.Vector3();
    this.orientation = new THREE.Quaternion();

    // Angles (kept for banked turn model)
    this.yaw = yaw;
    this.pitch = pitch;
    this.roll = roll;

    // Throttle/speed
    this.maxThrottle = Number.isFinite(maxThrottle) && maxThrottle > 0 ? maxThrottle : Infinity;
    if (!Number.isFinite(this.maxThrottle) || this.maxThrottle <= 0){
      this.maxThrottle = Infinity;
    }
    this.unlimitedPropulsion = unlimitedPropulsion || !Number.isFinite(maxThrottle);
    this.additionalPropulsionGain = Number.isFinite(unlimitedPropulsionGain)
      ? Math.max(0, unlimitedPropulsionGain)
      : (this.maxBoostSpeed ?? 0);
    this.throttle = 0.5;
    this.targetThrottle = 0.5;
    this.speed = 0;

    // Params
    this.minSpeed = minSpeed;
    this.maxSpeed = maxSpeed;
    this.maxBoostSpeed = maxBoostSpeed;
    this.acceleration = acceleration;
    this.afterburnerAcceleration = afterburnerAcceleration;
    this.throttleResponse = throttleResponse;
    this.turnRates = turnRates;
    this.rollStability = rollStability;
    this.bankTurnFactor = bankTurnFactor;
    this.drag = drag;
    this.brakeDrag = brakeDrag;
    this.gravity = gravity;
    this.propulsorLift = propulsorLift;
    this.propulsorThrust = propulsorThrust;
    this.propulsorResponse = propulsorResponse;

    // Visual propulsion hooks
    this.propulsorHeat = 0;
    this.propulsorRefs = [];
    this.navigationLightsEnabled = true;
    this.navigationLights = [];
    this.auxiliaryLights = [];
    this.auxiliaryLightsEnabled = false;
    this.auxiliaryLightIntensity = 1;

    // Extras
    this.altitude = 0;
    this.aim = { x: 0, y: 0 }; // optional input channel

    // Mesh
    this.mesh = null;

    this._updateOrientation();
  }

  attachMesh(mesh){
    this.mesh = mesh ?? null;
    this.propulsorRefs = Array.isArray(mesh?.userData?.propulsors) ? mesh.userData.propulsors : [];
    this.navigationLights = Array.isArray(mesh?.userData?.navigationLights)
      ? mesh.userData.navigationLights
      : [];
    this.auxiliaryLights = Array.isArray(mesh?.userData?.auxiliaryLights)
      ? mesh.userData.auxiliaryLights
      : [];
    if (this.mesh){
      this.mesh.position.copy(this.position);
      this.mesh.quaternion.copy(this.orientation);

      // Target gizmo (only once)
      if (!this.mesh.getObjectByName?.('leadTarget')){
        const targetGeometry = new THREE.SphereGeometry(0.45, 12, 12);
        const targetMaterial = new THREE.MeshBasicMaterial({ color: 0xffe26f, toneMapped: false });
        targetMaterial.depthTest = false;
        targetMaterial.depthWrite = false;
        const leadTarget = new THREE.Mesh(targetGeometry, targetMaterial);
        leadTarget.name = 'leadTarget';
        leadTarget.position.set(0, 10, 0);
        leadTarget.renderOrder = 2;
        this.mesh.add(leadTarget);
      }
      this._applyPropulsorIntensity(this.propulsorHeat, this._getNormalizedSpeed());
      this._applyNavigationLights();
      this._applyAuxiliaryLights();
    }
  }

  setThrottle(value){
    const limit = this.maxThrottle;
    if (Number.isFinite(limit)){
      this.targetThrottle = THREE.MathUtils.clamp(value ?? 0, 0, limit);
    } else {
      this.targetThrottle = Math.max(0, value ?? 0);
    }
  }

  reset({ position, velocity, yaw = 0, pitch = 0, roll = 0, throttle = 0.35 } = {}){
    if (position) this.position.copy(position);
    if (velocity) this.velocity.copy(velocity); else this.velocity.set(0, 0, 0);

    this.speed = this.minSpeed * 0.7;
    if (Number.isFinite(this.maxThrottle)){
      this.throttle = THREE.MathUtils.clamp(throttle ?? 0.35, 0, this.maxThrottle);
      this.targetThrottle = this.throttle;
    } else {
      this.throttle = Math.max(0, throttle ?? 0.35);
      this.targetThrottle = this.throttle;
    }

    this.yaw = yaw; this.pitch = pitch; this.roll = roll;
    this._updateOrientation();

    this.propulsorHeat = this.throttle;
    this._applyPropulsorIntensity(this.propulsorHeat, this._getNormalizedSpeed());
    this._applyNavigationLights();
    this._applyAuxiliaryLights();

    if (this.mesh){
      this.mesh.position.copy(this.position);
      this.mesh.quaternion.copy(this.orientation);
      const leadTarget = this.mesh.getObjectByName?.('leadTarget');
      if (leadTarget) leadTarget.position.set(0, 10, 0);
    }
  }

  /**
   * @param {number} dt
   * @param {Object} input  { pitch, yaw, roll, throttleAdjust, brake, aim?:{x,y} }
   * @param {Object} hooks  {
   *    queryVolume?: fn(position:THREE.Vector3, options?:Object):{
   *      floor?:number|null,
   *      ceiling?:number|null,
   *      distanceToSurface?:number,
   *      inside?:boolean,
   *      normal?:THREE.Vector3|null
   *    },
   *    collisionRadius?:number,
   *    clearance?:{ floor?:number, ceiling?:number, lateral?:number },
   *  }
   */
  update(dt, input = {}, hooks = {}){
    const delta = Math.max(0, dt ?? 0);
    if (delta <= 0) return;

    // Optional aim input (not used in physics yet, but kept for HUD/camera)
    if (input.aim){
      this.aim.x = THREE.MathUtils.clamp(input.aim.x ?? 0, -1, 1);
      this.aim.y = THREE.MathUtils.clamp(input.aim.y ?? 0, -1, 1);
    }

    // Throttle smoothing + braking cap
    const throttleAdjust = THREE.MathUtils.clamp(input.throttleAdjust ?? 0, -1, 1);
    const limit = this.maxThrottle;
    this.targetThrottle += throttleAdjust * delta * 0.8;
    if (Number.isFinite(limit)){
      this.targetThrottle = THREE.MathUtils.clamp(this.targetThrottle, 0, limit);
      if (input.brake) this.targetThrottle = Math.min(this.targetThrottle, limit * 0.2);
    } else {
      this.targetThrottle = Math.max(0, this.targetThrottle);
      if (input.brake){
        this.targetThrottle = Math.min(this.targetThrottle, this.throttle * 0.5);
      }
    }
    const throttleBlend = 1 - Math.exp(-this.throttleResponse * delta);
    this.throttle += (this.targetThrottle - this.throttle) * throttleBlend;
    if (Number.isFinite(limit)){
      this.throttle = THREE.MathUtils.clamp(this.throttle, 0, limit);
    } else {
      this.throttle = Math.max(0, this.throttle);
    }

    // Afterburner curve (boost only for high throttle)
    const normalizedThrottle = Number.isFinite(limit) && limit > 0
      ? THREE.MathUtils.clamp(this.throttle / limit, 0, 1)
      : Math.min(1, this.throttle);
    const throttleBoost = THREE.MathUtils.clamp((normalizedThrottle - 0.55) / 0.45, 0, 1);
    const boostFactor = throttleBoost * throttleBoost; // ease-in
    const baseSpeed = this.minSpeed + (this.maxSpeed - this.minSpeed) * normalizedThrottle;
    let speedTarget = THREE.MathUtils.lerp(baseSpeed, this.maxBoostSpeed, boostFactor);
    if (this.unlimitedPropulsion && this.throttle > 1){
      const extraThrottle = this.throttle - 1;
      const gain = this.additionalPropulsionGain > 0 ? this.additionalPropulsionGain : this.maxBoostSpeed;
      speedTarget += Math.max(0, gain) * extraThrottle;
    }
    const accelRate = this.acceleration + this.afterburnerAcceleration * boostFactor;
    const speedBlend = 1 - Math.exp(-accelRate * delta / Math.max(1, speedTarget));
    this.speed += (speedTarget - this.speed) * speedBlend;

    // Never fully stall
    this.speed = Math.max(this.minSpeed * 0.3, this.speed);

    // Inputs
    const yawInput   = THREE.MathUtils.clamp(input.yaw ?? 0,   -1, 1);
    const pitchInput = THREE.MathUtils.clamp(input.pitch ?? 0, -1, 1);
    const rollInput  = THREE.MathUtils.clamp(input.roll ?? 0,  -1, 1);

    // Turn integration + stability
    this.yaw   += yawInput   * this.turnRates.yaw   * delta;
    this.pitch += pitchInput * this.turnRates.pitch * delta;
    this.pitch  = THREE.MathUtils.clamp(this.pitch, THREE.MathUtils.degToRad(-70), THREE.MathUtils.degToRad(70));

    this.roll  += rollInput  * this.turnRates.roll  * delta;
    this.roll  -= this.roll * this.rollStability * delta;
    this.roll   = THREE.MathUtils.clamp(this.roll, THREE.MathUtils.degToRad(-110), THREE.MathUtils.degToRad(110));

    // Banked turning adds yaw with roll
    const bankTurn = this.roll * this.bankTurnFactor * Math.min(1, this.speed / this.maxSpeed);
    this.yaw += bankTurn * delta;

    // Pose
    this._updateOrientation();

    // Forward desired velocity & smoothing
    const forward = TMP_VECTOR.copy(FORWARD_AXIS).applyQuaternion(this.orientation).normalize();
    const desiredVelocity = TMP_VECTOR2.copy(forward).multiplyScalar(this.speed);
    this.velocity.lerp(desiredVelocity, 1 - Math.exp(-3.5 * delta));

    // Afterburner thrust bias along forward when boosting and pitching up
    if (boostFactor > 0){
      const climbFactor = Math.max(0.12, forward.z + 0.12); // adds vertical assist when nose-up
      const thrust = this.propulsorThrust * boostFactor * climbFactor;
      this.velocity.addScaledVector(forward, thrust * delta);
    }

    // Gravity minus some lift at high throttle
    const lift = this.propulsorLift * boostFactor;
    const effectiveGravity = Math.max(0, this.gravity - lift);
    const gravityVector = TMP_VECTOR3.set(0, 0, -effectiveGravity * delta);
    this.velocity.add(gravityVector);

    // Drag (heavier with brake)
    const brakeApplied = input.brake ? this.brakeDrag : this.drag;
    this.velocity.multiplyScalar(Math.max(0, 1 - brakeApplied * delta));

    // Integrate position
    this.position.addScaledVector(this.velocity, delta);

    // Volumetric collision sampling
    const collisionRadius = Math.max(0.25, hooks.collisionRadius ?? 6);
    const clearanceDefaults = hooks.clearance ?? {};
    const floorClearance = Number.isFinite(clearanceDefaults.floor)
      ? clearanceDefaults.floor
      : collisionRadius * 0.65;
    const ceilingClearance = Number.isFinite(clearanceDefaults.ceiling)
      ? clearanceDefaults.ceiling
      : collisionRadius * 0.55;
    const lateralClearance = Number.isFinite(clearanceDefaults.lateral)
      ? clearanceDefaults.lateral
      : collisionRadius * 0.75;

    let volumeSample = null;
    const queryVolume = hooks.queryVolume;
    if (typeof queryVolume === 'function'){
      volumeSample = queryVolume(this.position, {
        radius: collisionRadius,
      }) || null;
    }

    if (volumeSample){
      const { floor, ceiling, normal, inside, distanceToSurface } = volumeSample;

      if (Number.isFinite(floor)){
        this.altitude = this.position.z - floor;
        const minAltitude = floor + floorClearance;
        if (this.position.z < minAltitude){
          this.position.z = minAltitude;
          if (this.velocity.z < 0){
            this.velocity.z = 0;
          }
        }
      }

      if (Number.isFinite(ceiling)){
        const maxAltitude = ceiling - ceilingClearance;
        if (this.position.z > maxAltitude){
          this.position.z = maxAltitude;
          if (this.velocity.z > 0){
            this.velocity.z = 0;
          }
        }
      }

      if (normal && typeof normal.x === 'number'){
        const normalVector = normal.clone ? normal.clone() : new THREE.Vector3(normal.x, normal.y, normal.z);
        const strength = normalVector.length();
        if (strength > 1e-3){
          normalVector.normalize();
          const verticalWeight = Math.abs(normalVector.z);
          const predominantlyLateral = verticalWeight < 0.6;
          const separation = Math.max(0, distanceToSurface ?? 0);
          if (inside || (predominantlyLateral && separation < lateralClearance)){
            const required = inside ? (lateralClearance + separation) : (lateralClearance - separation);
            const correction = inside ? required : Math.max(0, required);
            if (correction > 0){
              this.position.addScaledVector(normalVector, correction);
              const velocityTowardsWall = this.velocity.dot(normalVector);
              if (velocityTowardsWall < 0){
                this.velocity.addScaledVector(normalVector, -velocityTowardsWall);
              }
            }
          }
        }
      }
    }

    // Sync mesh
    if (this.mesh){
      this.mesh.position.copy(this.position);
      this.mesh.quaternion.copy(this.orientation);
    }

    // VFX heat follows throttle/boost
    this._updatePropulsors(delta, Math.max(this.throttle, boostFactor));
  }

  getState(){
    return {
      position: this.position.clone(),
      velocity: this.velocity.clone(),
      orientation: this.orientation.clone(),
      speed: this.velocity.length(),
      throttle: this.throttle,
      targetThrottle: this.targetThrottle,
      altitude: this.altitude,
      aim: { x: this.aim.x, y: this.aim.y },
      navigationLights: this.navigationLightsEnabled,
      auxiliaryLights: this.auxiliaryLightsEnabled,
    };
  }

  // --- internals ---

  _updateOrientation(){
    // Using ZXY so roll (X) feels natural with banked turn coupling
    TMP_EULER.set(this.pitch, this.roll, this.yaw, 'ZXY');
    this.orientation.setFromEuler(TMP_EULER);
  }

  _updatePropulsors(dt, targetIntensity = this.throttle){
    const blend = dt > 0 ? 1 - Math.exp(-this.propulsorResponse * dt) : 1;
    const { intensityTarget, speedFactor } = this._resolvePropulsorIntensity(targetIntensity);
    this.propulsorHeat += (intensityTarget - this.propulsorHeat) * blend;
    this.propulsorHeat = THREE.MathUtils.clamp(this.propulsorHeat, 0, 1);
    this._applyPropulsorIntensity(this.propulsorHeat, speedFactor);
  }

  _resolvePropulsorIntensity(targetIntensity){
    const baseTarget = THREE.MathUtils.clamp(targetIntensity ?? 0, 0, 1.2);
    const speedFactor = THREE.MathUtils.clamp(this._getNormalizedSpeed(), 0, 1);
    const intensityTarget = THREE.MathUtils.clamp(Math.max(baseTarget, speedFactor), 0, 1);
    return { intensityTarget, speedFactor };
  }

  _applyPropulsorIntensity(level, speedFactor = this._getNormalizedSpeed()){
    if (!this.propulsorRefs || this.propulsorRefs.length === 0) return;
    const intensity = THREE.MathUtils.clamp(level ?? 0, 0, 1);
    const velocityLevel = THREE.MathUtils.clamp(speedFactor ?? intensity, 0, 1);
    for (const propulsor of this.propulsorRefs){
      if (!propulsor) continue;

      if (propulsor.light){
        const min = propulsor.minIntensity ?? 0.25;
        const max = propulsor.maxIntensity ?? 2.8;
        propulsor.light.intensity = THREE.MathUtils.lerp(min, max, intensity);
        if (propulsor.coolLightColor && propulsor.hotLightColor){
          propulsor.light.color.copy(propulsor.coolLightColor).lerp(propulsor.hotLightColor, velocityLevel);
        }
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
        if (propulsor.coolColor && propulsor.hotColor){
          propulsor.glowMaterial.color.copy(propulsor.coolColor).lerp(propulsor.hotColor, velocityLevel);
        }
      }

      if (propulsor.glowMesh){
        const minScale = propulsor.minScale ?? 0.7;
        const maxScale = propulsor.maxScale ?? 1.65;
        const speedScale = THREE.MathUtils.lerp(1, propulsor.speedScale ?? 1.6, Math.pow(velocityLevel, propulsor.speedScalePower ?? 1.15));
        const scale = THREE.MathUtils.lerp(minScale, maxScale, intensity) * speedScale;
        const minLength = propulsor.minLength ?? ((propulsor.scaleZ ?? 1.6) * 0.7);
        const maxLength = propulsor.maxLength ?? ((propulsor.scaleZ ?? 1.6) * 1.6);
        const length = THREE.MathUtils.lerp(minLength, maxLength, Math.pow(velocityLevel, propulsor.lengthPower ?? 1.1));
        propulsor.glowMesh.scale.set(scale, scale, length * speedScale);
        }

      if (propulsor.housingMaterial && typeof propulsor.housingMaterial.emissiveIntensity === 'number'){
        const minEmissive = propulsor.minEmissive ?? 0.05;
        const maxEmissive = propulsor.maxEmissive ?? 0.45;
        propulsor.housingMaterial.emissiveIntensity = THREE.MathUtils.lerp(minEmissive, maxEmissive, intensity);
      }
    }
  }

  setAuxiliaryLightsActive(enabled, intensity = null){
    const clampedIntensity = Number.isFinite(intensity)
      ? THREE.MathUtils.clamp(intensity, 0, 1)
      : null;

    this.auxiliaryLightsEnabled = !!enabled;

    if (clampedIntensity !== null){
      this.auxiliaryLightIntensity = clampedIntensity;
    } else if (this.auxiliaryLightsEnabled){
      const current = Number.isFinite(this.auxiliaryLightIntensity)
        ? this.auxiliaryLightIntensity
        : 1;
      this.auxiliaryLightIntensity = current > 0 ? THREE.MathUtils.clamp(current, 0, 1) : 1;
    }

    this._applyAuxiliaryLights();
  }

  getAuxiliaryLightLevel(){
    return THREE.MathUtils.clamp(this.auxiliaryLightIntensity ?? 0, 0, 1);
  }

  adjustAuxiliaryLightLevel(delta = 0, { autoEnable = true } = {}){
    if (!Number.isFinite(delta) || delta === 0){
      return this.getAuxiliaryLightLevel();
    }

    const current = this.getAuxiliaryLightLevel();
    const next = THREE.MathUtils.clamp(current + delta, 0, 1);

    if (!autoEnable){
      if (next !== current){
        this.auxiliaryLightIntensity = next;
        this._applyAuxiliaryLights();
      }
      return this.getAuxiliaryLightLevel();
    }

    if (next <= 0){
      this.auxiliaryLightsEnabled = false;
      this.auxiliaryLightIntensity = 0;
    } else {
      this.auxiliaryLightsEnabled = true;
      this.auxiliaryLightIntensity = next;
    }

    this._applyAuxiliaryLights();
    return this.getAuxiliaryLightLevel();
  }

  _applyAuxiliaryLights(){
    if (!Array.isArray(this.auxiliaryLights)) return;
    const enabled = this.auxiliaryLightsEnabled;
    const level = enabled ? this.getAuxiliaryLightLevel() : 0;
    for (const aux of this.auxiliaryLights){
      if (!aux) continue;
      if (aux.light){
        const maxIntensity = Number.isFinite(aux.maxIntensity) ? aux.maxIntensity : (aux.light.intensity ?? 1);
        aux.light.intensity = maxIntensity * level;
        aux.light.visible = enabled || (aux.minIntensity ?? 0) > 0;
        if (Number.isFinite(aux.distance)) aux.light.distance = aux.distance;
      }
      if (aux.target && aux.light){
        aux.light.target.position.copy(aux.target.position);
      }
      if (aux.material){
        const minOpacity = aux.minOpacity ?? 0.04;
        const maxOpacity = aux.maxOpacity ?? aux.material.opacity ?? 1;
        const opacity = enabled ? THREE.MathUtils.lerp(minOpacity, maxOpacity, Math.min(1, level)) : minOpacity;
        aux.material.opacity = opacity;
        aux.material.needsUpdate = true;
      }
    }
  }

  _getNormalizedSpeed(){
    const reference = Number.isFinite(this.maxBoostSpeed) && this.maxBoostSpeed > 0
      ? this.maxBoostSpeed
      : Number.isFinite(this.maxSpeed) && this.maxSpeed > 0
        ? this.maxSpeed
        : Math.max(1, this.minSpeed);
    if (reference <= 0) return 0;
    const current = Math.max(0, this.velocity.length(), Number.isFinite(this.speed) ? this.speed : 0);
    return THREE.MathUtils.clamp(current / reference, 0, 1.2);
  }

  _applyNavigationLights(){
    if (!Array.isArray(this.navigationLights)) return;
    for (const lightRef of this.navigationLights){
      if (!lightRef) continue;
      if (lightRef.light){
        const maxIntensity = Number.isFinite(lightRef.maxIntensity)
          ? lightRef.maxIntensity
          : lightRef.light.intensity ?? 1;
        const minIntensity = Number.isFinite(lightRef.minIntensity)
          ? lightRef.minIntensity
          : 0;
        lightRef.light.intensity = this.navigationLightsEnabled ? maxIntensity : minIntensity;
        lightRef.light.visible = this.navigationLightsEnabled || minIntensity > 0;
      }
      if (lightRef.material){
        const maxOpacity = Number.isFinite(lightRef.maxOpacity)
          ? lightRef.maxOpacity
          : lightRef.material.opacity ?? 1;
        const minOpacity = Number.isFinite(lightRef.minOpacity)
          ? lightRef.minOpacity
          : 0;
        lightRef.material.opacity = this.navigationLightsEnabled ? maxOpacity : minOpacity;
        lightRef.material.needsUpdate = true;
      }
      if (lightRef.mesh){
        const keepVisible = this.navigationLightsEnabled || lightRef.keepVisibleWhenOff;
        lightRef.mesh.visible = keepVisible;
      }
    }
  }

  setNavigationLightsEnabled(enabled){
    const desired = !!enabled;
    if (desired === this.navigationLightsEnabled) return;
    this.navigationLightsEnabled = desired;
    this._applyNavigationLights();
  }

  areNavigationLightsEnabled(){
    return this.navigationLightsEnabled;
  }
}

// --- simple stylized arcade plane with triple propulsor VFX ---
export function createPlaneMesh(){
  const group = new THREE.Group();

  const fuselageMaterial = new THREE.MeshStandardMaterial({ color: 0xf0f3ff, metalness: 0.35, roughness: 0.45 });
  const noseMaterial     = new THREE.MeshStandardMaterial({ color: 0xd13b4a, metalness: 0.4,  roughness: 0.3  });
  const accentMaterial   = new THREE.MeshStandardMaterial({ color: 0x2a4f9b, metalness: 0.45, roughness: 0.32 });

  const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(2.2, 12, 8, 16), fuselageMaterial);
  fuselage.rotation.z = Math.PI / 2;
  fuselage.castShadow = true;
  fuselage.receiveShadow = true;
  group.add(fuselage);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(2.2, 4.5, 14), noseMaterial);
  nose.position.set(0, 9.3, 0);
  nose.rotation.x = Math.PI;
  nose.castShadow = true;
  group.add(nose);

  const tail = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3.5, 10), accentMaterial);
  tail.position.set(0, -7.8, 0);
  tail.castShadow = true;
  group.add(tail);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(18, 3, 0.6), accentMaterial);
  wing.position.set(0, 0.8, 0);
  wing.castShadow = true;
  wing.receiveShadow = true;
  group.add(wing);

  const tailWing = new THREE.Mesh(new THREE.BoxGeometry(8, 2.2, 0.45), accentMaterial);
  tailWing.position.set(0, -6.5, 0.2);
  tailWing.castShadow = true;
  tailWing.receiveShadow = true;
  group.add(tailWing);

  const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.4, 4.2), accentMaterial);
  rudder.position.set(0, -7.2, 2.1);
  rudder.castShadow = true;
  group.add(rudder);

  // Propulsor VFX setup
  const propulsorHousingMaterial = new THREE.MeshStandardMaterial({
    color: 0x314166, metalness: 0.78, roughness: 0.28,
    emissive: 0x121c33, emissiveIntensity: 0.08,
  });
  const baseGlowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    toneMapped: false, side: THREE.DoubleSide,
  });

  const propulsorOffsets = [
    new THREE.Vector3(-4.4, -5.1, -0.5),
    new THREE.Vector3( 4.4, -5.1, -0.5),
    new THREE.Vector3( 0.0, -8.4, -0.2),
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

    const isCenter = index === 2;
    const coolColor = new THREE.Color(isCenter ? 0x66d8ff : 0x58caff);
    const hotColor = new THREE.Color(isCenter ? 0xfff0c4 : 0xffc884);
    glowMaterial.color.copy(coolColor);

    const light = new THREE.PointLight(0xffffff, 0, isCenter ? 140 : 90, 2.8);
    light.position.copy(offset);
    light.position.y -= isCenter ? 1.2 : 0.8;
    const coolLightColor = new THREE.Color(isCenter ? 0x74d4ff : 0x65e2ff);
    const hotLightColor = new THREE.Color(isCenter ? 0xfff3d2 : 0xffd2a4);
    light.color.copy(coolLightColor);
    group.add(light);

    propulsors.push({
      light,
      glowMesh: glow,
      glowMaterial,
      housingMaterial: housing.material,
      minIntensity: 0.35,
      maxIntensity: isCenter ? 3.8 : 2.9,
      minOpacity: 0.12,
      maxOpacity: 0.95,
      minScale: 0.75,
      maxScale: isCenter ? 1.8 : 1.55,
      scaleZ: isCenter ? 2.2 : 1.6,
      minEmissive: 0.08,
      maxEmissive: isCenter ? 0.7 : 0.5,
      minLength: isCenter ? 1.9 : 1.3,
      maxLength: isCenter ? 3.6 : 2.4,
      coolColor,
      hotColor,
      coolLightColor,
      hotLightColor,
      speedScale: isCenter ? 2.4 : 1.9,
      speedScalePower: isCenter ? 1.25 : 1.18,
      lengthPower: 1.22,
    });
  });

  const navigationLights = [];
  const navigationLightConfigs = [
    { position: new THREE.Vector3(-9.3, 0.6, 0.8), color: 0xff5f72, intensity: 1.1, range: 200, minOpacity: 0.08 },
    { position: new THREE.Vector3(9.3, 0.6, 0.8), color: 0x68ff9c, intensity: 1.1, range: 200, minOpacity: 0.08 },
    { position: new THREE.Vector3(0, 8.1, -0.3), color: 0x9edaff, intensity: 1.45, range: 320, minOpacity: 0.16, keepVisibleWhenOff: true, radius: 0.42 },
  ];
  navigationLightConfigs.forEach((config) => {
    const light = new THREE.PointLight(
      config.color,
      config.intensity ?? 1.1,
      config.range ?? 220,
      2.4,
    );
    light.position.copy(config.position);
    group.add(light);

    const lensMaterial = new THREE.MeshBasicMaterial({
      color: config.color,
      transparent: true,
      opacity: config.opacity ?? 0.92,
      toneMapped: false,
    });
    const lens = new THREE.Mesh(new THREE.SphereGeometry(config.radius ?? 0.34, 12, 12), lensMaterial);
    lens.position.copy(config.position);
    lens.renderOrder = 4;
    lens.userData.skipShadowAuto = true;
    group.add(lens);

    navigationLights.push({
      light,
      mesh: lens,
      material: lensMaterial,
      maxIntensity: light.intensity,
      minIntensity: config.minIntensity ?? 0,
      maxOpacity: lensMaterial.opacity,
      minOpacity: config.minOpacity ?? 0.12,
      keepVisibleWhenOff: !!config.keepVisibleWhenOff,
    });
  });

  const auxiliaryLights = [];
  const spotlightMaterial = new THREE.MeshBasicMaterial({ color: 0xb9d8ff, transparent: true, opacity: 0.08, toneMapped: false });
  const spotlightGeometry = new THREE.CylinderGeometry(0.28, 0.12, 0.8, 10, 1, true);
  const noseSpot = new THREE.SpotLight(0xd6ecff, 0, 460, Math.PI / 6.2, 0.32, 1.18);
  noseSpot.position.set(0, 7.6, -0.4);
  const noseTarget = new THREE.Object3D();
  noseTarget.position.set(0, 45, -6);
  group.add(noseSpot);
  group.add(noseTarget);
  noseSpot.target = noseTarget;
  const noseEmitter = new THREE.Mesh(spotlightGeometry, spotlightMaterial.clone());
  noseEmitter.position.copy(noseSpot.position);
  noseEmitter.rotation.x = Math.PI / 2;
  group.add(noseEmitter);
  auxiliaryLights.push({
    light: noseSpot,
    target: noseTarget,
    material: noseEmitter.material,
    maxIntensity: 2.6,
    minOpacity: 0.04,
  });

  const bellySpot = new THREE.SpotLight(0xc8e7ff, 0, 360, Math.PI / 5.2, 0.4, 1.15);
  bellySpot.position.set(0, -1.2, -1.6);
  const bellyTarget = new THREE.Object3D();
  bellyTarget.position.set(0, 16, -8);
  group.add(bellySpot);
  group.add(bellyTarget);
  bellySpot.target = bellyTarget;
  const bellyEmitter = new THREE.Mesh(spotlightGeometry.clone(), spotlightMaterial.clone());
  bellyEmitter.position.copy(bellySpot.position);
  bellyEmitter.rotation.x = Math.PI / 2;
  group.add(bellyEmitter);
  auxiliaryLights.push({
    light: bellySpot,
    target: bellyTarget,
    material: bellyEmitter.material,
    maxIntensity: 1.8,
    minOpacity: 0.05,
  });

  group.traverse((obj) => {
    if (obj.isMesh){
      if (obj.userData?.skipShadowAuto) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  group.name = 'ArcadePlane';
  group.userData.propulsors = propulsors;
  group.userData.navigationLights = navigationLights;
  group.userData.auxiliaryLights = auxiliaryLights;

  return group;
}
