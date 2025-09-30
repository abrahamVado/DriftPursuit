import { PlaneController as BasePlaneController } from '../sandbox/PlaneController.js';

const THREE = (typeof window !== 'undefined' ? window.THREE : globalThis?.THREE) ?? null;
if (!THREE) throw new Error('Terra PlaneController requires THREE to be loaded globally');

export class TerraPlaneController extends BasePlaneController {
  constructor(options = {}){
    const { unlimitedPropulsionGain, ...rest } = options ?? {};
    super({
      ...rest,
      maxThrottle: Infinity,
      unlimitedPropulsion: true,
      unlimitedPropulsionGain: unlimitedPropulsionGain ?? undefined,
    });
    this.turretYaw = 0;
    this.turretPitch = 0;
    this.turretAimTarget = { x: 0, y: 0 };
    this.turretYawLimit = options.turretYawLimit ?? THREE.MathUtils.degToRad(178);
    this.turretPitchLimit = options.turretPitchLimit ?? THREE.MathUtils.degToRad(65);
    this.turretResponse = options.turretResponse ?? 9.5;
    this._turretDidUpdateThisFrame = false;
    this.turretYawGroup = null;
    this.turretPitchGroup = null;
    this.turretStickYaw = null;
    this.turretStickPitch = null;
  }

  attachMesh(mesh, {
    turretYawGroup = null,
    turretPitchGroup = null,
    stickYaw = null,
    stickPitch = null,
  } = {}){
    super.attachMesh(mesh);
    this.turretYawGroup = turretYawGroup;
    this.turretPitchGroup = turretPitchGroup;
    this.turretStickYaw = stickYaw;
    this.turretStickPitch = stickPitch;
    this._applyTurretManipulator(this.turretAimTarget, 0);
  }

  reset(options = {}){
    super.reset(options);
    this.turretYaw = 0;
    this.turretPitch = 0;
    this.turretAimTarget.x = 0;
    this.turretAimTarget.y = 0;
    this._turretDidUpdateThisFrame = false;
    this._applyTurretManipulator(this.turretAimTarget, 0);
  }

  update(dt, input = {}, extra = {}){
    if (input && input.aim){
      this.setTurretAimTarget(input.aim);
    }
    super.update(dt, input, extra);
    this._applyTurretManipulator(this.turretAimTarget, dt);
    this._turretDidUpdateThisFrame = true;
  }

  stepTurretAim(dt){
    if (this._turretDidUpdateThisFrame){
      this._turretDidUpdateThisFrame = false;
      return;
    }
    this._applyTurretManipulator(this.turretAimTarget, dt);
  }

  setTurretAimTarget(aim, { immediate = false } = {}){
    if (!aim) aim = { x: 0, y: 0 };
    this.turretAimTarget.x = THREE.MathUtils.clamp(aim.x ?? 0, -1, 1);
    this.turretAimTarget.y = THREE.MathUtils.clamp(aim.y ?? 0, -1, 1);
    if (immediate){
      this.turretYaw = this.turretAimTarget.x * this.turretYawLimit;
      this.turretPitch = this.turretAimTarget.y * this.turretPitchLimit;
      this._updateTurretVisuals();
    }
  }

  setTurretOrientation({ yaw, pitch } = {}){
    if (typeof yaw === 'number'){
      this.turretYaw = THREE.MathUtils.clamp(yaw, -this.turretYawLimit, this.turretYawLimit);
      this.turretAimTarget.x = THREE.MathUtils.clamp(this.turretYaw / this.turretYawLimit, -1, 1);
    }
    if (typeof pitch === 'number'){
      this.turretPitch = THREE.MathUtils.clamp(pitch, -this.turretPitchLimit, this.turretPitchLimit);
      this.turretAimTarget.y = THREE.MathUtils.clamp(this.turretPitch / this.turretPitchLimit, -1, 1);
    }
    this._updateTurretVisuals();
  }

  getState(){
    const state = super.getState();
    state.turret = {
      yaw: this.turretYaw,
      pitch: this.turretPitch,
      aim: { x: this.turretAimTarget.x, y: this.turretAimTarget.y },
    };
    return state;
  }

  _applyTurretManipulator(aim, dt){
    if (!aim) aim = this.turretAimTarget;
    const targetYaw = (aim.x ?? 0) * this.turretYawLimit;
    const targetPitch = (aim.y ?? 0) * this.turretPitchLimit;
    const blend = dt > 0 ? 1 - Math.exp(-this.turretResponse * dt) : 1;
    this.turretYaw += (targetYaw - this.turretYaw) * blend;
    this.turretPitch += (targetPitch - this.turretPitch) * blend;
    this.turretYaw = THREE.MathUtils.clamp(this.turretYaw, -this.turretYawLimit, this.turretYawLimit);
    this.turretPitch = THREE.MathUtils.clamp(this.turretPitch, -this.turretPitchLimit, this.turretPitchLimit);
    this._updateTurretVisuals();
  }

  _updateTurretVisuals(){
    if (this.turretYawGroup){
      this.turretYawGroup.rotation.z = this.turretYaw;
    }
    if (this.turretPitchGroup){
      this.turretPitchGroup.rotation.x = this.turretPitch;
    }
    if (this.turretStickYaw){
      this.turretStickYaw.rotation.z = this.turretYaw * 0.8;
    }
    if (this.turretStickPitch){
      this.turretStickPitch.rotation.x = this.turretPitch * 0.9;
    }
  }
}

export function createPlaneMesh(){
  const group = new THREE.Group();

  const fuselageMaterial = new THREE.MeshStandardMaterial({ color: 0xf0f3ff, metalness: 0.35, roughness: 0.45 });
  const noseMaterial = new THREE.MeshStandardMaterial({ color: 0xd13b4a, metalness: 0.4, roughness: 0.3 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: 0x2a4f9b, metalness: 0.45, roughness: 0.32 });
  const turretMaterial = new THREE.MeshStandardMaterial({ color: 0x445c7a, metalness: 0.32, roughness: 0.4 });
  const stickMaterial = new THREE.MeshStandardMaterial({ color: 0xe0c86b, metalness: 0.2, roughness: 0.45 });

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

  const turretBase = new THREE.Group();
  turretBase.name = 'turretBase';
  turretBase.position.set(0, 2.4, 1.2);
  group.add(turretBase);

  const turretPedestalGeometry = new THREE.CylinderGeometry(1.4, 1.6, 1.4, 18);
  const turretPedestal = new THREE.Mesh(turretPedestalGeometry, turretMaterial);
  turretPedestal.position.set(0, 0, 0.7);
  turretPedestal.castShadow = true;
  turretPedestal.receiveShadow = true;
  turretBase.add(turretPedestal);

  const turretYawGroup = new THREE.Group();
  turretYawGroup.name = 'turretYawGroup';
  turretYawGroup.position.set(0, 0, 1.5);
  turretBase.add(turretYawGroup);

  const turretYawBody = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 1.4, 18), turretMaterial);
  turretYawBody.rotation.x = Math.PI / 2;
  turretYawBody.castShadow = true;
  turretYawBody.receiveShadow = true;
  turretYawGroup.add(turretYawBody);

  const turretPitchGroup = new THREE.Group();
  turretPitchGroup.name = 'turretPitchGroup';
  turretPitchGroup.position.set(0, 0, 0.9);
  turretYawGroup.add(turretPitchGroup);

  const turretHousing = new THREE.Mesh(new THREE.SphereGeometry(1.05, 18, 14, 0, Math.PI), turretMaterial);
  turretHousing.rotation.x = Math.PI / 2;
  turretHousing.castShadow = true;
  turretHousing.receiveShadow = true;
  turretPitchGroup.add(turretHousing);

  const barrelGeometry = new THREE.CylinderGeometry(0.22, 0.26, 6.4, 16);
  const barrel = new THREE.Mesh(barrelGeometry, accentMaterial);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 3.2, 0.15);
  barrel.castShadow = true;
  turretPitchGroup.add(barrel);

  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12), noseMaterial);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, 6.15, 0.15);
  muzzle.castShadow = true;
  turretPitchGroup.add(muzzle);

  const stickAssembly = new THREE.Group();
  stickAssembly.position.set(-1.8, 1.4, 1.6);
  stickAssembly.name = 'turretStickAssembly';
  group.add(stickAssembly);

  const stickYaw = new THREE.Group();
  stickYaw.name = 'turretStickYaw';
  stickAssembly.add(stickYaw);

  const yawHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.8, 12), stickMaterial);
  yawHandle.rotation.x = Math.PI / 2;
  yawHandle.castShadow = true;
  stickYaw.add(yawHandle);

  const stickPitch = new THREE.Group();
  stickPitch.name = 'turretStickPitch';
  stickPitch.position.set(0, 1.2, 0);
  stickYaw.add(stickPitch);

  const pitchHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2, 12), stickMaterial);
  pitchHandle.position.set(0, 0, 1);
  pitchHandle.castShadow = true;
  stickPitch.add(pitchHandle);

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
  group.userData.turretYawGroup = turretYawGroup;
  group.userData.turretPitchGroup = turretPitchGroup;
  group.userData.turretStickYaw = stickYaw;
  group.userData.turretStickPitch = stickPitch;
  group.userData.turretMuzzle = muzzle;
  group.userData.propulsors = propulsors;

  group.updateMatrixWorld(true);
  const boundingBox = new THREE.Box3().setFromObject(group);
  const boundingSphere = boundingBox.getBoundingSphere(new THREE.Sphere());
  group.userData.boundingCenter = boundingSphere.center.clone();
  group.userData.boundingRadius = boundingSphere.radius;

  return group;
}
