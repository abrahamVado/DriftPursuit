import {
  createHull,
  createPropulsorModule,
  createTurretModule,
  createMissileRackModule,
  createBombBayModule,
  createLampTurretModule,
  PART_BUILDERS,
} from './parts.js';
import {
  attachPart,
  validateAssembly,
  getHardpoint,
  getPlug,
} from './assembly.js';

const HULL_BUILDERS = {
  swiftHawk: createHull,
};

export const MODULE_BUILDERS = {
  propulsorStandard: (options) => createPropulsorModule('standard', options),
  propulsorHeavy:    (options) => createPropulsorModule('heavy', options),
  propulsorVector:   (options) => createPropulsorModule('vector', options),
  turret:            createTurretModule,
  missileRack:       createMissileRackModule,
  bombBay:           createBombBayModule,
  lampTurret:        createLampTurretModule,
};

export const defaultBlueprint = {
  hull: { type: 'swiftHawk' },
  attachments: [
    { socket: 'leftWing',  part: 'propulsorHeavy'   },
    { socket: 'rightWing', part: 'propulsorHeavy'   },
    { socket: 'tailMount', part: 'propulsorVector'  },
    { socket: 'dorsal',    part: 'turret'           },
    { socket: 'belly',     part: 'bombBay'          },
    { socket: 'nose',      part: 'lampTurret'       },
  ],
};

function resolveHullBuilder(spec){
  if (!spec) return createHull;
  if (typeof spec === 'string') return HULL_BUILDERS[spec] ?? createHull;
  if (typeof spec === 'object'){
    const type = spec.type ?? 'swiftHawk';
    return HULL_BUILDERS[type] ?? createHull;
  }
  return createHull;
}

function resolveHullOptions(spec){
  if (spec && typeof spec === 'object' && !Array.isArray(spec)){
    return spec.options ?? {};
  }
  return {};
}

function resolveModuleBuilder(name){
  return MODULE_BUILDERS[name] ?? PART_BUILDERS[name];
}

export function createShipMesh(blueprint = defaultBlueprint) {
  const hullSpec = blueprint?.hull ?? 'swiftHawk';
  const hullBuilder = resolveHullBuilder(hullSpec);
  const hullOptions = resolveHullOptions(hullSpec);
  const hull = hullBuilder(hullOptions);

  const propulsors = Array.isArray(hull.userData?.propulsors) ? [...hull.userData.propulsors] : [];
  const navigationLights = Array.isArray(hull.userData?.navigationLights) ? [...hull.userData.navigationLights] : [];
  const auxiliaryLights = Array.isArray(hull.userData?.auxiliaryLights) ? [...hull.userData.auxiliaryLights] : [];

  const attachments = [];

  const modules = Array.isArray(blueprint?.attachments) ? blueprint.attachments : [];
  modules.forEach((moduleSpec) => {
    if (!moduleSpec) return;
    const { socket, part, plug = 'mount', options = {} } = moduleSpec;
    if (!socket || !part) return;
    const builder = resolveModuleBuilder(part);
    if (typeof builder !== 'function') {
      throw new Error(`Unknown module "${part}"`);
    }
    const module = builder(options);
    module.name = module.name || part;

    // Ensure strict compatibility passes: plug.tags must contain ALL socket.tags
    const socketDesc = getHardpoint(hull, socket);
    const plugDesc   = getPlug(module, plug);
    if (socketDesc && plugDesc) {
      const plugTags   = plugDesc.tags ?? new Set();
      const socketTags = socketDesc.tags ?? new Set();
      socketTags.forEach(t => plugTags.add(t));
      plugDesc.tags = plugTags;
    }

    const attachment = attachPart(hull, socket, module, { plugName: plug });
    attachments.push({ ...attachment, blueprint: moduleSpec });

    if (module.userData?.propulsorRef) {
      propulsors.push(module.userData.propulsorRef);
    }
    if (Array.isArray(module.userData?.navigationLights)) {
      module.userData.navigationLights.forEach((entry) => {
        if (!entry) return;
        if (entry.light) hull.add(entry.light);
        if (entry.mesh) hull.add(entry.mesh);
        navigationLights.push(entry);
      });
    }
    if (module.userData?.navigationLight) {
      const entry = module.userData.navigationLight;
      if (entry.light) hull.add(entry.light);
      if (entry.mesh) hull.add(entry.mesh);
      navigationLights.push(entry);
    }
    if (Array.isArray(module.userData?.auxiliaryLights)) {
      module.userData.auxiliaryLights.forEach((entry) => {
        if (!entry) return;
        auxiliaryLights.push(entry);
      });
    }
    if (module.userData?.auxRef) {
      auxiliaryLights.push(module.userData.auxRef);
    }
  });

  hull.userData.propulsors = propulsors;
  hull.userData.navigationLights = navigationLights;
  hull.userData.auxiliaryLights = auxiliaryLights;

  const validation = validateAssembly(hull, { attachments });
  hull.userData.assembly = { blueprint, attachments, validation };
  if (!validation.valid) {
    console.warn?.('[MarsShip] Assembly validation issues:', validation.issues);
  }

  return hull;
}

export default createShipMesh;
