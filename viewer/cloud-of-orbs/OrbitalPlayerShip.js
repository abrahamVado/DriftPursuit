import { requireTHREE } from '../shared/threeSetup.js';
import { createPlaneMesh as createSurfacePlaneMesh } from '../terra/PlaneController.js';

const THREE = requireTHREE();

const BOOST_LIGHT_COLOR = new THREE.Color(0xfff0d2);
const BOOST_GLOW_COLOR = new THREE.Color(0xfff4dc);

const DEFAULT_CONFIG = Object.freeze({
  maxSpeed: 24000,
  minSpeed: 0,
  acceleration: 3.6,
  velocityResponsiveness: 6.5,
  brakeDeceleration: 14800,
  throttleResponsiveness: 1.85,
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
  const plane = createSurfacePlaneMesh();
  plane.name = 'OrbitalPlayerShip';
  plane.scale.setScalar(2.6);

  const turretBase = plane.getObjectByName?.('turretBase');
  if (turretBase?.parent){
    turretBase.parent.remove(turretBase);
  }

  const propulsors = Array.isArray(plane.userData?.propulsors) ? plane.userData.propulsors : [];
  propulsors.forEach((propulsor) => {
    if (!propulsor) return;
    propulsor.minIntensity = propulsor.minIntensity ?? 0.45;
    propulsor.maxIntensity = (propulsor.maxIntensity ?? 3.2) * 1.35;
    propulsor.minOpacity = Math.min(propulsor.minOpacity ?? 0.16, 0.2);
    propulsor.maxOpacity = Math.max(propulsor.maxOpacity ?? 0.95, 0.98);
    propulsor.minScale = (propulsor.minScale ?? 0.85) * 1.1;
    propulsor.maxScale = (propulsor.maxScale ?? 1.8) * 1.4;
    propulsor.scaleZ = (propulsor.scaleZ ?? 1.6) * 1.45;
    propulsor.minEmissive = propulsor.minEmissive ?? 0.12;
    propulsor.maxEmissive = (propulsor.maxEmissive ?? 0.7) * 1.25;
    if (propulsor.light){
      propulsor.light.distance = Math.max(propulsor.light.distance ?? 0, 520);
      propulsor.light.decay = 2.4;
      propulsor.light.intensity = 0;
      propulsor.light.color.set(0xffc27a);
      propulsor.light.userData ??= {};
      if (!propulsor.light.userData.baseColor){
        propulsor.light.userData.baseColor = propulsor.light.color.clone();
      }
    }
    if (propulsor.glowMaterial){
      propulsor.glowMaterial.color.set(0xffc68a);
      propulsor.glowMaterial.userData ??= {};
      if (!propulsor.glowMaterial.userData.baseColor){
        propulsor.glowMaterial.userData.baseColor = propulsor.glowMaterial.color.clone();
      }
    }
  });

  plane.traverse((obj) => {
    if (obj.isMesh){
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  return plane;
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

    this.propulsorRefs = Array.isArray(this.mesh.userData?.propulsors) ? this.mesh.userData.propulsors : [];
    this.propulsorHeat = 0;
    this.propulsorResponse = 4.5;
    this.propulsorBoost = 0;
    this.propulsorBoostResponse = 5.8;
    this._applyPropulsorIntensity(0);

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
    this.propulsorHeat = 0;
    this._applyPropulsorIntensity(0);
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

  update(dt = 0, input = {}, { drag = 0.0025, launchBoost = 0 } = {}){
    if (!this.active){
      return this.state;
    }

    const boostLevel = THREE.MathUtils.clamp(
      Number.isFinite(launchBoost) ? launchBoost : (launchBoost ? 1 : 0),
      0,
      1,
    );

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

    const throttleOverride = input?.throttleOverride;
    if (Number.isFinite(throttleOverride)){
      this.throttle = THREE.MathUtils.clamp(throttleOverride, 0, 1);
    }

    if (input?.brake){
      this.speed = Math.max(0, this.speed - this.config.brakeDeceleration * dt);
      this.throttle = Math.max(0, this.throttle - 1.4 * dt);
    }

    if (boostLevel > 0 && !input?.brake){
      const assistedThrottle = THREE.MathUtils.lerp(0.42, 0.78, boostLevel);
      if (this.throttle < assistedThrottle){
        const catchUp = dt > 0 ? 1 - Math.exp(-this.config.throttleResponsiveness * 2.2 * dt) : 1;
        this.throttle = THREE.MathUtils.clamp(
          this.throttle + (assistedThrottle - this.throttle) * catchUp,
          0,
          1,
        );
      }
    }

    const maxSpeedBoost = THREE.MathUtils.lerp(1, 1.18, boostLevel);
    const accelerationBoost = THREE.MathUtils.lerp(1, 1.75, boostLevel);
    const velocityResponseBoost = THREE.MathUtils.lerp(1, 1.45, boostLevel);
    const desiredMaxSpeed = this.config.maxSpeed * maxSpeedBoost;
    const desiredSpeed = THREE.MathUtils.clamp(
      this.config.minSpeed + (desiredMaxSpeed - this.config.minSpeed) * this.throttle,
      this.config.minSpeed,
      desiredMaxSpeed,
    );
    const accelRate = this.config.acceleration * accelerationBoost;
    const accelBlend = dt > 0 ? 1 - Math.exp(-accelRate * dt) : 1;
    this.speed += (desiredSpeed - this.speed) * accelBlend;
    if (this.speed < 0.5){
      this.speed = 0;
    }

    const forward = this.getForwardVector(this.forward);
    const desiredVelocity = TMP_FORWARD.copy(forward).multiplyScalar(this.speed);
    const velocityRate = this.config.velocityResponsiveness * velocityResponseBoost;
    const velocityBlend = dt > 0 ? 1 - Math.exp(-velocityRate * dt) : 1;
    this.velocity.lerp(desiredVelocity, velocityBlend);

    const effectiveDrag = drag * THREE.MathUtils.lerp(1, 0.52, boostLevel);
    if (effectiveDrag > 0){
      const damping = Math.max(0, 1 - effectiveDrag * dt * 60);
      this.velocity.multiplyScalar(damping);
    }

    this.mesh.position.addScaledVector(this.velocity, dt);

    if (this.speed > 5){
      this.hasLaunched = true;
    }

    const throttleLevel = Math.max(
      this.throttle,
      THREE.MathUtils.clamp(this.speed / Math.max(1, desiredMaxSpeed), 0, 1),
    );
    this._updatePropulsors(dt, throttleLevel, { boostLevel });

    if (this._needsMatrixUpdate){
      this.mesh.updateMatrixWorld?.();
      this._needsMatrixUpdate = false;
    }

    this.up.copy(this.getUpVector(this.up));

    return this.state;
  }

  _updatePropulsors(dt, target = 0, { boostLevel = 0 } = {}){
    if (!this.propulsorRefs || this.propulsorRefs.length === 0) return;
    const blend = dt > 0 ? 1 - Math.exp(-this.propulsorResponse * dt) : 1;
    const clampedTarget = THREE.MathUtils.clamp(target, 0, 1);
    this.propulsorHeat += (clampedTarget - this.propulsorHeat) * blend;
    this.propulsorHeat = THREE.MathUtils.clamp(this.propulsorHeat, 0, 1);
    const boost = THREE.MathUtils.clamp(boostLevel ?? 0, 0, 1);
    const boostBlend = dt > 0 ? 1 - Math.exp(-this.propulsorBoostResponse * dt) : 1;
    this.propulsorBoost += (boost - this.propulsorBoost) * boostBlend;
    this.propulsorBoost = THREE.MathUtils.clamp(this.propulsorBoost, 0, 1);
    this._applyPropulsorIntensity(this.propulsorHeat);
  }

  _applyPropulsorIntensity(level){
    if (!this.propulsorRefs || this.propulsorRefs.length === 0) return;
    const intensity = THREE.MathUtils.clamp(level ?? 0, 0, 1);
    const boost = THREE.MathUtils.clamp(this.propulsorBoost ?? 0, 0, 1);
    const boostIntensityScale = THREE.MathUtils.lerp(1, 1.75, boost);
    const boostOpacityScale = THREE.MathUtils.lerp(1, 1.22, boost);
    const boostScale = THREE.MathUtils.lerp(1, 1.38, boost);
    const boostEmissiveScale = THREE.MathUtils.lerp(1, 1.6, boost);
    for (const propulsor of this.propulsorRefs){
      if (!propulsor) continue;
      if (propulsor.light){
        const min = propulsor.minIntensity ?? 0.4;
        const max = (propulsor.maxIntensity ?? 4.6) * boostIntensityScale;
        propulsor.light.intensity = THREE.MathUtils.lerp(min, max, intensity);
        const baseColor = propulsor.light.userData?.baseColor;
        if (baseColor){
          propulsor.light.color.copy(baseColor).lerp(BOOST_LIGHT_COLOR, boost);
        }
      }
      if (propulsor.glowMaterial){
        const minOpacity = propulsor.minOpacity ?? 0.18;
        const maxOpacity = propulsor.maxOpacity ?? 1.0;
        propulsor.glowMaterial.opacity = intensity <= 0.001
          ? 0
          : THREE.MathUtils.lerp(minOpacity, maxOpacity * boostOpacityScale, intensity);
        const baseGlowColor = propulsor.glowMaterial.userData?.baseColor;
        if (baseGlowColor){
          propulsor.glowMaterial.color.copy(baseGlowColor).lerp(BOOST_GLOW_COLOR, boost);
        }
      }
      if (propulsor.glowMesh){
        const minScale = propulsor.minScale ?? 0.9;
        const maxScale = (propulsor.maxScale ?? 2.3) * boostScale;
        const scale = THREE.MathUtils.lerp(minScale, maxScale, intensity);
        const scaleZ = propulsor.scaleZ ?? 2.2;
        propulsor.glowMesh.scale.set(scale, scale, scale * scaleZ);
      }
      if (propulsor.housingMaterial && typeof propulsor.housingMaterial.emissiveIntensity === 'number'){
        const minEmissive = propulsor.minEmissive ?? 0.12;
        const maxEmissive = (propulsor.maxEmissive ?? 0.9) * boostEmissiveScale;
        propulsor.housingMaterial.emissiveIntensity = THREE.MathUtils.lerp(minEmissive, maxEmissive, intensity);
      }
    }
  }
}

export default OrbitalPlayerShip;
