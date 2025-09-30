import THREE from '../shared/threeProxy.js';
import { PlaneController as BasePlaneController, createPlaneMesh } from '../sandbox/PlaneController.js';

if (!THREE) throw new Error('Mars PlaneController requires THREE to be loaded globally');

const FORWARD_AXIS = new THREE.Vector3(0, 1, 0);
const DEFAULT_MUZZLE_OFFSET = new THREE.Vector3(0, 9.6, 1.6);

export class MarsPlaneController extends BasePlaneController {
  constructor(options = {}) {
    const {
      projectileVelocity = 720,
      weaponCooldown = 0.16,
      weaponHeatRise = 0.22,
      weaponHeatDrop = 0.55,
      muzzleOffset = DEFAULT_MUZZLE_OFFSET,
      boostThrottle = 0.65,
      ...rest
    } = options;

    super({
      minSpeed: 26,
      maxSpeed: 210,
      maxBoostSpeed: 330,
      acceleration: 52,
      afterburnerAcceleration: 86,
      gravity: 3.72,
      propulsorLift: 3.72 * 1.08,
      drag: 0.11,
      brakeDrag: 0.46,
      throttleResponse: 2.1,
      ...rest,
    });

    this.weaponCooldownTime = weaponCooldown;
    this.weaponHeatRise = weaponHeatRise;
    this.weaponHeatDrop = weaponHeatDrop;
    this.weaponCooldown = 0;
    this.weaponHeat = 0;
    this.projectileVelocity = projectileVelocity;
    this.muzzleOffset = muzzleOffset.clone();
    this.boostThrottle = boostThrottle;
  }

  reset(options = {}) {
    super.reset(options);
    this.weaponCooldown = 0;
    this.weaponHeat = 0;
  }

  update(dt, input = {}, hooks = {}) {
    if (dt <= 0) return;

    this.weaponCooldown = Math.max(0, this.weaponCooldown - dt);
    this.weaponHeat = Math.max(0, this.weaponHeat - this.weaponHeatDrop * dt);

    const throttleAdjust = THREE.MathUtils.clamp(
      (input.throttleAdjust ?? input.throttle ?? 0)
        + (input.boost ? 0.55 : 0),
      -1,
      1,
    );

    super.update(dt, { ...input, throttleAdjust }, hooks);
  }

  firePrimary() {
    if (this.weaponCooldown > 0 || this.weaponHeat >= 1) {
      return null;
    }
    this.weaponCooldown = this.weaponCooldownTime;
    this.weaponHeat = Math.min(1.2, this.weaponHeat + this.weaponHeatRise);

    const direction = FORWARD_AXIS.clone().applyQuaternion(this.orientation).normalize();
    const origin = this.muzzleOffset.clone().applyQuaternion(this.orientation).add(this.position);
    const velocity = direction.clone().setLength(this.projectileVelocity).add(this.velocity);

    return { origin, direction, velocity };
  }

  getState(sampleHeightFn) {
    const base = super.getState();
    let altitude = base.altitude;
    if (typeof sampleHeightFn === 'function') {
      const ground = sampleHeightFn(this.position.x, this.position.y);
      if (Number.isFinite(ground)) {
        altitude = this.position.z - ground;
      }
    }

    return {
      ...base,
      speed: this.velocity.length(),
      altitude,
      throttle: this.throttle,
      boost: this.throttle >= this.boostThrottle,
      weapon: {
        ready: this.weaponCooldown <= 0 && this.weaponHeat < 1,
        heat: THREE.MathUtils.clamp(this.weaponHeat, 0, 1),
      },
    };
  }
}

export { createPlaneMesh };
