import THREE from '../../shared/threeProxy.js';
import {
  createHardpoint,
  createPlugDescriptor,
  registerHardpoints,
} from './assembly.js';

const DEFAULT_COLORS = {
  hullPrimary: 0xe6ebf6,
  hullSecondary: 0xb7c4dd,
  hullAccent: 0x304a73,
  canopy: 0x1c2f4a,
  trim: 0xd95d39,
};

function applyShadowSettings(object){
  object.traverse?.((child) => {
    if (child.isMesh){
      if (child.userData?.skipShadowAuto) return;
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return object;
}

function createNavigationLight({ position, color, intensity = 1.2, range = 200, radius = 0.32, minOpacity = 0.08, keepVisibleWhenOff = false }) {
  const light = new THREE.PointLight(color, intensity, range, 2.6);
  light.position.copy(position);

  const lensMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    toneMapped: false,
  });
  const lens = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 12), lensMaterial);
  lens.position.copy(position);
  lens.renderOrder = 4;
  lens.userData.skipShadowAuto = true;

  return {
    light,
    mesh: lens,
    material: lensMaterial,
    maxIntensity: intensity,
    minIntensity: 0,
    maxOpacity: lensMaterial.opacity,
    minOpacity,
    keepVisibleWhenOff,
  };
}

export function createHull(options = {}) {
  const colors = { ...DEFAULT_COLORS, ...(options.colors ?? {}) };
  const group = new THREE.Group();
  group.name = 'MarsSurveyorHull';

  const primaryMaterial = new THREE.MeshStandardMaterial({
    color: colors.hullPrimary,
    metalness: 0.32,
    roughness: 0.48,
  });
  const secondaryMaterial = new THREE.MeshStandardMaterial({
    color: colors.hullSecondary,
    metalness: 0.28,
    roughness: 0.42,
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: colors.hullAccent,
    metalness: 0.44,
    roughness: 0.3,
  });
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: colors.trim,
    metalness: 0.52,
    roughness: 0.32,
  });
  const canopyMaterial = new THREE.MeshStandardMaterial({
    color: colors.canopy,
    metalness: 0.18,
    roughness: 0.32,
    transparent: true,
    opacity: 0.78,
    envMapIntensity: 1.05,
  });

  const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(2.6, 13, 16, 24), primaryMaterial);
  fuselage.rotation.z = Math.PI / 2;
  fuselage.castShadow = true;
  fuselage.receiveShadow = true;
  group.add(fuselage);

  const spine = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 12.4, 14, 1, true), secondaryMaterial);
  spine.rotation.x = Math.PI / 2;
  spine.position.set(0, -0.6, 0.4);
  group.add(spine);

  const dorsalFin = new THREE.Mesh(new THREE.ConeGeometry(1.1, 4.2, 16), accentMaterial);
  dorsalFin.rotation.x = Math.PI;
  dorsalFin.position.set(0, -3.6, 2.3);
  group.add(dorsalFin);

  const tailPlane = new THREE.Mesh(new THREE.BoxGeometry(8.4, 2.2, 0.5), accentMaterial);
  tailPlane.position.set(0, -7.4, 0.2);
  group.add(tailPlane);

  const wings = new THREE.Mesh(new THREE.BoxGeometry(16.4, 3.2, 0.6), accentMaterial);
  wings.position.set(0, -2.4, 0);
  group.add(wings);

  const wingTrim = new THREE.Mesh(new THREE.BoxGeometry(16.8, 0.6, 0.4), trimMaterial);
  wingTrim.position.set(0, -0.8, -0.24);
  group.add(wingTrim);

  const canopy = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.9, 4.4, 12, 1, true), canopyMaterial);
  canopy.rotation.z = Math.PI / 2;
  canopy.position.set(0.2, 3.6, 0.8);
  canopy.userData.skipShadowAuto = true;
  group.add(canopy);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(2.1, 4.6, 18), secondaryMaterial);
  nose.position.set(0, 8.2, 0.1);
  nose.rotation.x = Math.PI;
  group.add(nose);

  const bellyKeel = new THREE.Mesh(new THREE.BoxGeometry(4.4, 5.6, 0.7), secondaryMaterial);
  bellyKeel.position.set(0, -4.6, -1.6);
  group.add(bellyKeel);

  const navLights = [];
  const navConfigs = [
    { position: new THREE.Vector3(-8.6, -1.6, 0.4), color: 0xff6b7a },
    { position: new THREE.Vector3(8.6, -1.6, 0.4), color: 0x7cffd1 },
    { position: new THREE.Vector3(0.6, 7.4, -0.2), color: 0xa8dfff, intensity: 1.4, range: 320, radius: 0.36, minOpacity: 0.12, keepVisibleWhenOff: true },
  ];
  navConfigs.forEach((config) => {
    const entry = createNavigationLight(config);
    group.add(entry.light);
    group.add(entry.mesh);
    navLights.push(entry);
  });

  const hardpoints = [
    createHardpoint({ name: 'leftWing', kind: 'propulsor', size: 1, tags: ['wing', 'port'], position: new THREE.Vector3(-5.9, -2.8, -0.4) }),
    createHardpoint({ name: 'rightWing', kind: 'propulsor', size: 1, tags: ['wing', 'starboard'], position: new THREE.Vector3(5.9, -2.8, -0.4) }),
    createHardpoint({ name: 'tailMount', kind: 'propulsor', size: 1.2, tags: ['tail'], position: new THREE.Vector3(0, -9.2, -0.4) }),
    createHardpoint({ name: 'dorsal', kind: 'turret', size: 1, tags: ['dorsal'], position: new THREE.Vector3(0, -1.6, 2.5) }),
    createHardpoint({ name: 'belly', kind: 'payload', size: 1.4, tags: ['belly'], position: new THREE.Vector3(0, -2.8, -2.6) }),
    createHardpoint({ name: 'nose', kind: 'utility', size: 1, tags: ['nose'], position: new THREE.Vector3(0, 7.2, -0.2) }),
  ];
  registerHardpoints(group, hardpoints);

  group.userData.propulsors = [];
  group.userData.navigationLights = navLights;
  group.userData.auxiliaryLights = [];

  applyShadowSettings(group);

  return group;
}

function createPropulsorMaterials(variant) {
  switch (variant) {
    case 'heavy':
      return {
        housing: new THREE.MeshStandardMaterial({ color: 0x2a3356, metalness: 0.78, roughness: 0.22, emissive: 0x161a33, emissiveIntensity: 0.08 }),
        ring: new THREE.MeshStandardMaterial({ color: 0x6f86ff, metalness: 0.62, roughness: 0.32 }),
        glowCold: new THREE.Color(0x75c7ff),
        glowHot: new THREE.Color(0xffecb2),
      };
    case 'vector':
      return {
        housing: new THREE.MeshStandardMaterial({ color: 0x334a4a, metalness: 0.74, roughness: 0.24, emissive: 0x13201d, emissiveIntensity: 0.07 }),
        ring: new THREE.MeshStandardMaterial({ color: 0x91f1d8, metalness: 0.55, roughness: 0.28 }),
        glowCold: new THREE.Color(0x82ffe0),
        glowHot: new THREE.Color(0xf6ffcc),
      };
    default:
      return {
        housing: new THREE.MeshStandardMaterial({ color: 0x2f3a5c, metalness: 0.75, roughness: 0.25, emissive: 0x171d2f, emissiveIntensity: 0.08 }),
        ring: new THREE.MeshStandardMaterial({ color: 0x7aa7ff, metalness: 0.58, roughness: 0.3 }),
        glowCold: new THREE.Color(0x68d3ff),
        glowHot: new THREE.Color(0xffdc98),
      };
  }
}

export function createPropulsorModule(variant = 'standard', options = {}) {
  const group = new THREE.Group();
  group.name = `Propulsor_${variant}`;
  const { housing, ring, glowCold, glowHot } = createPropulsorMaterials(variant);

  const housingMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 1.05, 2.6, 18, 1, true), housing);
  housingMesh.position.set(0, -1.1, 0);
  group.add(housingMesh);

  const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.14, 12, 24), ring);
  ringMesh.rotation.x = Math.PI / 2;
  ringMesh.position.set(0, 0.2, 0);
  group.add(ringMesh);

  const glowMaterial = new THREE.MeshBasicMaterial({
    color: glowCold,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const glowMesh = new THREE.Mesh(new THREE.ConeGeometry(0.92, 3.6, 20, 1, true), glowMaterial);
  glowMesh.rotation.x = Math.PI;
  glowMesh.position.set(0, -2.8, 0);
  glowMesh.renderOrder = 3;
  group.add(glowMesh);

  const light = new THREE.PointLight(0xffffff, 0, variant === 'vector' ? 110 : 160, 2.9);
  light.position.set(0, -1.8, 0);
  group.add(light);

  const plugAnchor = new THREE.Object3D();
  plugAnchor.position.set(0, 0.6, 0);
  group.add(plugAnchor);
  const plug = createPlugDescriptor({
    name: 'mount',
    kind: 'propulsor',
    size: variant === 'heavy' ? 1.2 : 1,
    tags: ['wing', 'port', 'starboard', 'tail'],
    node: plugAnchor,
  });

  group.userData.plugs = [plug];
  group.userData.propulsorRef = {
    light,
    glowMesh,
    glowMaterial,
    housingMaterial: housingMesh.material,
    minIntensity: 0.32,
    maxIntensity: variant === 'heavy' ? 3.4 : 2.6,
    minOpacity: 0.12,
    maxOpacity: variant === 'heavy' ? 0.96 : 0.8,
    minScale: 0.8,
    maxScale: variant === 'vector' ? 1.7 : 1.4,
    scaleZ: variant === 'heavy' ? 1.8 : 1.5,
    minEmissive: 0.08,
    maxEmissive: variant === 'vector' ? 0.62 : 0.5,
    minLength: 1.2,
    maxLength: variant === 'heavy' ? 3.8 : 2.8,
    coolColor: glowCold,
    hotColor: glowHot,
    coolLightColor: glowCold.clone().multiplyScalar(1.05),
    hotLightColor: glowHot.clone(),
    speedScale: variant === 'vector' ? 2.4 : 1.9,
    speedScalePower: variant === 'vector' ? 1.2 : 1.1,
    lengthPower: 1.18,
  };
  group.userData.boundingRadius = variant === 'heavy' ? 2.4 : 2.1;
  group.userData.boundingCenter = new THREE.Vector3(0, -1.2, 0);

  applyShadowSettings(group);

  return group;
}

export function createTurretModule(options = {}) {
  const group = new THREE.Group();
  group.name = 'DorsalTurret';

  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x3a4a61, metalness: 0.6, roughness: 0.34 });
  const barrelMaterial = new THREE.MeshStandardMaterial({ color: 0x242b33, metalness: 0.68, roughness: 0.26 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.8, 16), baseMaterial);
  group.add(base);

  const housing = new THREE.Mesh(new THREE.SphereGeometry(1.1, 18, 16, 0, Math.PI), baseMaterial);
  housing.rotation.x = Math.PI / 2;
  housing.position.set(0, 0.7, 0);
  group.add(housing);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 3.4, 12), barrelMaterial);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 1.6, 0);
  group.add(barrel);

  const plugAnchor = new THREE.Object3D();
  plugAnchor.position.set(0, -0.4, 0);
  group.add(plugAnchor);
  const plug = createPlugDescriptor({ name: 'mount', kind: 'turret', size: 1, tags: ['dorsal'], node: plugAnchor });
  group.userData.plugs = [plug];

  group.userData.boundingRadius = 1.6;
  group.userData.boundingCenter = new THREE.Vector3(0, 0.6, 0);

  applyShadowSettings(group);

  return group;
}

export function createMissileRackModule(options = {}) {
  const group = new THREE.Group();
  group.name = 'MissileRack';

  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x424a55, metalness: 0.55, roughness: 0.38 });
  const missileMaterial = new THREE.MeshStandardMaterial({ color: 0xc9d4e6, metalness: 0.4, roughness: 0.3 });
  const tipMaterial = new THREE.MeshStandardMaterial({ color: 0xd95d39, metalness: 0.52, roughness: 0.32 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.2, 1.4), bodyMaterial);
  body.position.set(0, -0.4, 0);
  group.add(body);

  for (let i = 0; i < 4; i += 1) {
    const offsetX = (i % 2 === 0 ? -0.6 : 0.6);
    const offsetY = -1.1 + Math.floor(i / 2) * 1.4;
    const missile = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 2.6, 10), missileMaterial);
    missile.rotation.x = Math.PI / 2;
    missile.position.set(offsetX, offsetY, -0.1);
    group.add(missile);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 10), tipMaterial);
    tip.rotation.x = Math.PI / 2;
    tip.position.set(offsetX, offsetY + 1.3, -0.1);
    group.add(tip);
  }

  const plugAnchor = new THREE.Object3D();
  plugAnchor.position.set(0, 1.4, 0);
  group.add(plugAnchor);
  const plug = createPlugDescriptor({ name: 'mount', kind: 'payload', size: 1, tags: ['dorsal', 'belly'], node: plugAnchor });
  group.userData.plugs = [plug];

  group.userData.boundingRadius = 2.1;
  group.userData.boundingCenter = new THREE.Vector3(0, -0.5, -0.2);

  applyShadowSettings(group);

  return group;
}

export function createBombBayModule(options = {}) {
  const group = new THREE.Group();
  group.name = 'BombBay';

  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x363d49, metalness: 0.6, roughness: 0.28 });
  const bombMaterial = new THREE.MeshStandardMaterial({ color: 0xe4e0ce, metalness: 0.35, roughness: 0.42 });

  const frame = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.4, 0.6), frameMaterial);
  frame.position.set(0, 0, -0.6);
  group.add(frame);

  for (let i = 0; i < 3; i += 1) {
    const bomb = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 12), bombMaterial);
    bomb.position.set(-0.8 + i * 0.8, 0, -1.4);
    group.add(bomb);
    const casing = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.6, 10), bombMaterial);
    casing.rotation.x = Math.PI / 2;
    casing.position.set(-0.8 + i * 0.8, 0, -2.2);
    group.add(casing);
  }

  const plugAnchor = new THREE.Object3D();
  plugAnchor.position.set(0, 0.8, 0.2);
  group.add(plugAnchor);
  const plug = createPlugDescriptor({ name: 'mount', kind: 'payload', size: 1.2, tags: ['belly'], node: plugAnchor });
  group.userData.plugs = [plug];

  group.userData.boundingRadius = 1.9;
  group.userData.boundingCenter = new THREE.Vector3(0, -0.2, -1.4);

  applyShadowSettings(group);

  return group;
}

export function createLampTurretModule(options = {}) {
  const group = new THREE.Group();
  group.name = 'LampTurret';

  const housingMaterial = new THREE.MeshStandardMaterial({ color: 0x35415c, metalness: 0.6, roughness: 0.34 });
  const lensMaterial = new THREE.MeshStandardMaterial({ color: 0xbcdcff, metalness: 0.24, roughness: 0.18, transparent: true, opacity: 0.9, toneMapped: false });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.7, 14), housingMaterial);
  group.add(base);

  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.9, 18, 14, 0, Math.PI), housingMaterial);
  dome.rotation.x = Math.PI / 2;
  dome.position.set(0, 0.6, 0);
  group.add(dome);

  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.2, 12), lensMaterial);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 0.95, 0);
  lens.userData.skipShadowAuto = true;
  group.add(lens);

  const spotlight = new THREE.SpotLight(0xcfe9ff, 0, 420, Math.PI / 5.2, 0.34, 1.1);
  spotlight.position.set(0, 0.8, 0);
  const target = new THREE.Object3D();
  target.position.set(0, 20, -4);
  group.add(spotlight);
  group.add(target);
  spotlight.target = target;

  const beamMaterial = new THREE.MeshBasicMaterial({ color: 0xbfe1ff, transparent: true, opacity: 0, toneMapped: false });
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.85, 3.6, 16, 1, true), beamMaterial);
  beam.rotation.x = Math.PI / 2;
  beam.position.set(0, 1.4, -0.1);
  beam.renderOrder = 3;
  group.add(beam);

  const plugAnchor = new THREE.Object3D();
  plugAnchor.position.set(0, -0.3, 0);
  group.add(plugAnchor);
  const plug = createPlugDescriptor({ name: 'mount', kind: 'utility', size: 1, tags: ['nose'], node: plugAnchor });
  group.userData.plugs = [plug];

  group.userData.auxRef = {
    light: spotlight,
    target,
    material: beamMaterial,
    maxIntensity: 2.4,
    minOpacity: 0.04,
  };

  group.userData.boundingRadius = 1.4;
  group.userData.boundingCenter = new THREE.Vector3(0, 0.6, 0);

  applyShadowSettings(group);

  return group;
}

export const PART_BUILDERS = {
  hull: createHull,
  propulsorStandard: (options) => createPropulsorModule('standard', options),
  propulsorHeavy: (options) => createPropulsorModule('heavy', options),
  propulsorVector: (options) => createPropulsorModule('vector', options),
  turret: createTurretModule,
  missileRack: createMissileRackModule,
  bombBay: createBombBayModule,
  lampTurret: createLampTurretModule,
};

export default {
  createHull,
  createPropulsorModule,
  createTurretModule,
  createMissileRackModule,
  createBombBayModule,
  createLampTurretModule,
  PART_BUILDERS,
};
