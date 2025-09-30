import { TerraPlaneController, createPlaneMesh } from './PlaneController.js';
import { CarController, createCarRig } from '../sandbox/CarController.js';
import { ChaseCamera } from '../sandbox/ChaseCamera.js';
import { CollisionSystem } from '../sandbox/CollisionSystem.js';
import { TerraHUD } from './TerraHUD.js';
import { TerraProjectileManager } from './Projectiles.js';
import { TerraInputManager } from './InputManager.js';
import {
  createRenderer,
  createPerspectiveCamera,
  enableWindowResizeHandling,
  requireTHREE,
} from '../shared/threeSetup.js';
import {
  loadMapDefinitions,
  selectMapDefinition,
} from './maps.js';
import {
  DEFAULT_WORLD_ENVIRONMENT,
  initializeWorldForMap,
} from './worldFactory.js';
import {
  createHud,
  createHudPresets,
  createMapSelectionHandler,
} from './hudConfig.js';
import { createVehicleSystem } from './vehicles.js';
import { preloadGLTFLoader } from './ensureGltfLoader.js';

const THREE = requireTHREE();

preloadGLTFLoader().catch((error) => {
  console.warn('[Terra] Failed to preload GLTFLoader module:', error);
});

const MAPS_ENDPOINT = './maps.json';
const DEFAULT_BODY_BACKGROUND = DEFAULT_WORLD_ENVIRONMENT.bodyBackground;
const SOLAR_SYSTEM_MAP_ID = 'solar-system';
const SPACE_TRANSITION_ALTITUDE = 10000;
const PLANET_APPROACH_DISTANCE = 500;
const SOLAR_MOVEMENT_SCALE = 1;

const SOLAR_ENTRY_POSITION = new THREE.Vector3(0, -8000, 12000);
const SOLAR_ENTRY_VELOCITY = new THREE.Vector3(0, 0, 0);

const FALLBACK_MAPS = [
  {
    id: SOLAR_SYSTEM_MAP_ID,
    name: 'Orbital Reach',
    description: 'Twin worlds orbit a radiant star amid deep-space vistas.',
    type: 'solar-system',
    environment: {
      background: '#050912',
      bodyBackground: 'linear-gradient(180deg, #02030a 0%, #050b1a 45%, #0a1328 100%)',
      fog: { color: '#060912', near: 16000, far: 48000 },
      sun: { position: [0, 0, 0], intensity: 1.25, color: '#ffe4a6' },
      hemisphere: { skyColor: '#0f1630', groundColor: '#03050a', intensity: 0.35 },
    },
  },
  {
    id: 'aurora-basin',
    name: 'Aurora Basin',
    description: 'Rolling terrain under bright aurora skies.',
    type: 'procedural',
    seed: 982451653,
    chunkSize: 640,
    radius: 3,
    environment: {
      background: '#90b6ff',
      bodyBackground: DEFAULT_BODY_BACKGROUND,
      fog: { color: '#a4c6ff', near: DEFAULT_WORLD_ENVIRONMENT.fog.near, far: DEFAULT_WORLD_ENVIRONMENT.fog.far },
      sun: {
        position: DEFAULT_WORLD_ENVIRONMENT.sun.position,
        intensity: DEFAULT_WORLD_ENVIRONMENT.sun.intensity,
        color: '#ffffff',
      },
      hemisphere: {
        skyColor: '#dce9ff',
        groundColor: '#2b4a2e',
        intensity: DEFAULT_WORLD_ENVIRONMENT.hemisphere.intensity,
      },
    },
  },
];

document.body.style.margin = '0';
document.body.style.overflow = 'hidden';
document.body.style.background = DEFAULT_BODY_BACKGROUND;

const renderer = createRenderer();

const scene = new THREE.Scene();
scene.background = new THREE.Color(DEFAULT_WORLD_ENVIRONMENT.backgroundColor);
scene.fog = new THREE.Fog(
  DEFAULT_WORLD_ENVIRONMENT.fog.color,
  DEFAULT_WORLD_ENVIRONMENT.fog.near,
  DEFAULT_WORLD_ENVIRONMENT.fog.far,
);

const camera = createPerspectiveCamera({ fov: 60, near: 0.1, far: 24000 });

const hemisphere = new THREE.HemisphereLight(
  DEFAULT_WORLD_ENVIRONMENT.hemisphere.skyColor,
  DEFAULT_WORLD_ENVIRONMENT.hemisphere.groundColor,
  DEFAULT_WORLD_ENVIRONMENT.hemisphere.intensity,
);
scene.add(hemisphere);

const sun = new THREE.DirectionalLight(
  DEFAULT_WORLD_ENVIRONMENT.sun.color,
  DEFAULT_WORLD_ENVIRONMENT.sun.intensity,
);
sun.position.set(
  DEFAULT_WORLD_ENVIRONMENT.sun.position[0],
  DEFAULT_WORLD_ENVIRONMENT.sun.position[1],
  DEFAULT_WORLD_ENVIRONMENT.sun.position[2],
);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -800;
sun.shadow.camera.right = 800;
sun.shadow.camera.top = 800;
sun.shadow.camera.bottom = -800;
sun.shadow.camera.far = 2400;
scene.add(sun);

const collisionSystem = new CollisionSystem({ world: null, crashMargin: 2.4, obstaclePadding: 3.2 });
const projectileManager = new TerraProjectileManager({ scene, world: null });
const ammoPresets = projectileManager.getAmmoTypes();

let availableMaps = [...FALLBACK_MAPS];
let defaultMapId = FALLBACK_MAPS[0]?.id ?? null;
let currentMapDefinition = FALLBACK_MAPS[0] ?? null;

const mapSelectionHandler = createMapSelectionHandler((mapId) => {
  if (!mapId) return;
  if (currentMapDefinition?.id === mapId) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('map', mapId);
    window.location.href = url.toString();
  } catch (error){
    window.location.search = `?map=${encodeURIComponent(mapId)}`;
  }
});

// Single source of truth for nav lights
let navigationLightsEnabled = true;

const hudPresets = createHudPresets();
const { hud } = createHud({
  TerraHUDClass: TerraHUD,
  ammoOptions: ammoPresets,
  mapOptions: availableMaps,
  onAmmoSelect: (ammoId) => {
    const accepted = projectileManager.setAmmoType(ammoId);
    if (!accepted){
      hud.setActiveAmmo(projectileManager.getCurrentAmmoId());
    }
  },
  onMapSelect: mapSelectionHandler,
  onToggleLights: handleNavigationLightsToggle,
  initialLightsActive: navigationLightsEnabled,
  presets: hudPresets,
});
hud.setActiveAmmo(projectileManager.getCurrentAmmoId());

const chaseCamera = new ChaseCamera(camera, {
  distance: 82,
  height: 28,
  stiffness: 4.2,
  lookStiffness: 6.8,
  forwardResponsiveness: 5.1,
  pitchInfluence: 0.36,
});

const SKY_CEILING = 36000;
const MAX_DEFAULT_VEHICLES = 5;

const planeCameraConfig = {
  distance: 82,
  height: 26,
  stiffness: 4.4,
  lookStiffness: 7.2,
  forwardResponsiveness: 5.4,
  pitchInfluence: 0.38,
};

const carCameraConfig = {
  distance: 42,
  height: 14,
  stiffness: 5.8,
  lookStiffness: 7.8,
  forwardResponsiveness: 6.4,
  pitchInfluence: 0.22,
};

const input = new TerraInputManager();
const LOCAL_PLAYER_ID = 'pilot-local';
const ORIGIN_FALLBACK = new THREE.Vector3(0, 0, 0);

const worldRef = { current: null };

let isInSolarSystem = false;
let lastTerraMapId = null;
let lastTerraMapDefinition = null;
let terraReturnPoint = null;

const vehicleSystem = createVehicleSystem({
  THREE,
  scene,
  chaseCamera,
  hud,
  hudPresets,
  projectileManager,
  collisionSystem,
  getWorld: () => worldRef.current,
  localPlayerId: LOCAL_PLAYER_ID,
  planeCameraConfig,
  carCameraConfig,
  maxDefaultVehicles: MAX_DEFAULT_VEHICLES,
  skyCeiling: SKY_CEILING,
  createPlaneMesh,
  createPlaneController: () => new TerraPlaneController(),
  createCarRig,
  createCarController: () => new CarController(),
});

function isSolarDefinition(definition){
  if (!definition) return false;
  if (definition.id === SOLAR_SYSTEM_MAP_ID) return true;
  const type = typeof definition.type === 'string' ? definition.type.toLowerCase() : null;
  if (type === 'solar-system') return true;
  const descriptorType = typeof definition.descriptor?.type === 'string'
    ? definition.descriptor.type.toLowerCase()
    : null;
  return descriptorType === 'solar-system';
}

function getDefinitionById(mapId){
  if (!mapId) return null;
  return availableMaps.find((entry) => entry.id === mapId)
    ?? FALLBACK_MAPS.find((entry) => entry.id === mapId)
    ?? null;
}

function rememberTerraDefinition(definition){
  if (!definition || isSolarDefinition(definition)) return;
  lastTerraMapId = definition.id ?? lastTerraMapId ?? defaultMapId;
  lastTerraMapDefinition = definition;
}

function applyWorldDefinition(mapDefinition){
  if (!mapDefinition) return null;
  const worldResult = initializeWorldForMap({
    scene,
    mapDefinition,
    currentWorld: worldRef.current,
    collisionSystem,
    projectileManager,
    environment: { document, hemisphere, sun },
  });
  worldRef.current = worldResult.world;
  currentMapDefinition = worldResult.mapDefinition ?? mapDefinition;
  hud.setActiveMap(currentMapDefinition?.id ?? '');
  isInSolarSystem = isSolarDefinition(currentMapDefinition);
  if (!isInSolarSystem){
    rememberTerraDefinition(currentMapDefinition);
  }
  return worldResult;
}

function enterSolarSystem(activeState){
  if (isInSolarSystem) return;
  const solarDefinition = getDefinitionById(SOLAR_SYSTEM_MAP_ID);
  if (!solarDefinition) return;
  if (!isSolarDefinition(currentMapDefinition)){
    rememberTerraDefinition(currentMapDefinition);
  }
  terraReturnPoint = activeState?.position ? activeState.position.clone() : null;

  const result = applyWorldDefinition(solarDefinition);
  if (!result){
    return;
  }

  const entryPosition = SOLAR_ENTRY_POSITION.clone();
  if (worldRef.current?.getPrimaryPlanetSpawnPoint){
    const spawnPoint = worldRef.current.getPrimaryPlanetSpawnPoint(640);
    if (spawnPoint){
      entryPosition.copy(spawnPoint);
    }
  }
  vehicleSystem.teleportActiveVehicle({ position: entryPosition, velocity: SOLAR_ENTRY_VELOCITY });
  const activeVehicle = vehicleSystem.getActiveVehicle();
  const state = activeVehicle ? vehicleSystem.getVehicleState(activeVehicle) : null;
  if (state){
    chaseCamera.snapTo(state);
    worldRef.current?.update?.(state.position);
  } else {
    worldRef.current?.update?.(entryPosition);
  }
}

function exitSolarSystem(activeState){
  if (!isInSolarSystem) return;
  const fallbackId = lastTerraMapId ?? defaultMapId;
  const targetDefinition = lastTerraMapDefinition
    ?? getDefinitionById(fallbackId)
    ?? availableMaps.find((entry) => !isSolarDefinition(entry))
    ?? FALLBACK_MAPS[0];
  if (!targetDefinition) return;

  applyWorldDefinition(targetDefinition);

  const world = worldRef.current;
  const basePoint = terraReturnPoint
    ? terraReturnPoint.clone()
    : activeState?.position
      ? activeState.position.clone()
      : ORIGIN_FALLBACK.clone();
  terraReturnPoint = null;

  if (!world || !basePoint){
    return;
  }

  world.update?.(basePoint);
  const ground = world.getHeightAt?.(basePoint.x, basePoint.y);
  const groundHeight = Number.isFinite(ground) ? ground : 0;
  const landingAltitude = groundHeight + 620;
  const returnPosition = new THREE.Vector3(basePoint.x, basePoint.y, landingAltitude);

  vehicleSystem.teleportActiveVehicle({ position: returnPosition, velocity: SOLAR_ENTRY_VELOCITY });
  const activeVehicle = vehicleSystem.getActiveVehicle();
  const state = activeVehicle ? vehicleSystem.getVehicleState(activeVehicle) : null;
  if (state){
    chaseCamera.snapTo(state);
    world.update?.(state.position);
  } else {
    world.update?.(returnPosition);
  }
}

function handleEnvironmentTransitions(activeVehicle, activeState){
  if (!activeState) return { activeVehicle, activeState };

  if (!isInSolarSystem){
    if (Number.isFinite(activeState.altitude) && activeState.altitude >= SPACE_TRANSITION_ALTITUDE){
      enterSolarSystem(activeState);
      const refreshedVehicle = vehicleSystem.getActiveVehicle() ?? activeVehicle;
      const refreshedState = refreshedVehicle ? vehicleSystem.getVehicleState(refreshedVehicle) : null;
      return { activeVehicle: refreshedVehicle, activeState: refreshedState ?? activeState };
    }
  } else {
    const world = worldRef.current;
    if (world?.getApproachInfo && activeState.position){
      const approach = world.getApproachInfo(activeState.position, PLANET_APPROACH_DISTANCE);
      if (approach && (approach.withinThreshold || (Number.isFinite(approach.distanceToSurface) && approach.distanceToSurface <= PLANET_APPROACH_DISTANCE))){
        exitSolarSystem(activeState);
        const refreshedVehicle = vehicleSystem.getActiveVehicle() ?? activeVehicle;
        const refreshedState = refreshedVehicle ? vehicleSystem.getVehicleState(refreshedVehicle) : null;
        return { activeVehicle: refreshedVehicle, activeState: refreshedState ?? activeState };
      }
    }
  }

  return { activeVehicle, activeState };
}

const FIRE_COOLDOWN = 0.35;
const MIN_FAILED_FIRE_DELAY = 0.12;
const activeFireSources = new Set();
let fireInputHeld = false;
let fireCooldownTimer = 0;

function setFireSourceActive(source, active){
  if (!source) return;
  if (active){
    activeFireSources.add(source);
  } else {
    activeFireSources.delete(source);
  }
  fireInputHeld = activeFireSources.size > 0;
}

function resetFireInput(){
  activeFireSources.clear();
  fireInputHeld = false;
}

function handleNavigationLightsToggle(active){
  navigationLightsEnabled = !!active;
  vehicleSystem.setNavigationLightsEnabled?.(navigationLightsEnabled);
  if (hud?.lightsActive !== navigationLightsEnabled){
    hud?.setLightsActive?.(navigationLightsEnabled, { silent: true });
  }
}

function getRequestedMapId(){
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get('map');
  } catch (error){
    return null;
  }
}

enableWindowResizeHandling({ renderer, camera });

function animate(now){
  requestAnimationFrame(animate);
  const dt = Math.min(0.08, (now - animate.lastTime) / 1000 || 0);
  animate.lastTime = now;
  animate.elapsedTime = (animate.elapsedTime ?? 0) + dt;

  const inputSample = input.readState(dt);
  const preTransitionScale = isInSolarSystem ? SOLAR_MOVEMENT_SCALE : 1;
  let { activeVehicle, activeState, hudData } = vehicleSystem.update({
    dt,
    elapsedTime: animate.elapsedTime,
    inputSample,
    movementScale: preTransitionScale,
  });

  const transitionResult = handleEnvironmentTransitions(activeVehicle, activeState);
  activeVehicle = transitionResult.activeVehicle ?? activeVehicle;
  activeState = transitionResult.activeState ?? activeState;

  fireCooldownTimer = Math.max(0, fireCooldownTimer - dt);
  if (fireInputHeld && fireCooldownTimer <= 0){
    const fired = vehicleSystem.fireActiveVehicleProjectile();
    fireCooldownTimer = fired ? FIRE_COOLDOWN : MIN_FAILED_FIRE_DELAY;
  }

  const projectileDt = dt * (isInSolarSystem ? SOLAR_MOVEMENT_SCALE : 1);
  projectileManager.update(projectileDt, {
    vehicles: vehicleSystem.getVehicles(),
    onVehicleHit: (vehicle, projectile) => {
      vehicleSystem.handleProjectileHit(vehicle, projectile);
    },
    onImpact: (impact) => {
      if (worldRef.current && typeof worldRef.current.applyProjectileImpact === 'function'){
        worldRef.current.applyProjectileImpact(impact);
      }
    },
  });

  if (activeVehicle && activeState){
    const mode = activeVehicle.modes[activeVehicle.mode];
    const cameraConfig = mode?.cameraConfig ?? planeCameraConfig;
    chaseCamera.setConfig(cameraConfig);
    chaseCamera.update(activeState, dt, inputSample?.cameraOrbit ?? null);
    worldRef.current?.update?.(activeState.position);
  } else if (worldRef.current){
    worldRef.current.update(ORIGIN_FALLBACK);
  }

  hud.update(hudData);

  renderer.render(scene, camera);
}
animate.lastTime = performance.now();
animate.elapsedTime = 0;

async function bootstrap(){
  const requestedId = getRequestedMapId();
  const origin = typeof window !== 'undefined' ? window.location.href : undefined;
  const fetchFn = typeof fetch === 'function' ? fetch : null;
  const definition = await loadMapDefinitions({
    endpoint: MAPS_ENDPOINT,
    requestedId,
    fetchFn,
    fallbackMaps: FALLBACK_MAPS,
    fallbackDefaultId: defaultMapId,
    origin,
  });

  availableMaps = Array.isArray(definition.maps) && definition.maps.length
    ? definition.maps
    : [...FALLBACK_MAPS];
  defaultMapId = definition.defaultId ?? availableMaps[0]?.id ?? defaultMapId;

  const selection = selectMapDefinition({
    maps: availableMaps,
    requestedId,
    fallbackId: defaultMapId,
    fallbackMaps: FALLBACK_MAPS,
  });

  availableMaps = selection.maps;
  defaultMapId = selection.id ?? defaultMapId;
  currentMapDefinition = selection.selected ?? availableMaps[0] ?? FALLBACK_MAPS[0];

  hud.setMapOptions(availableMaps);
  applyWorldDefinition(currentMapDefinition);

  vehicleSystem.spawnDefaultVehicles();
  vehicleSystem.handlePlayerJoin(LOCAL_PLAYER_ID, { initialMode: 'plane' });
  vehicleSystem.setNavigationLightsEnabled?.(navigationLightsEnabled);
  hud.setLightsActive?.(navigationLightsEnabled, { silent: true });

  const initialVehicle = vehicleSystem.getActiveVehicle()
    ?? vehicleSystem.getVehicles().get(LOCAL_PLAYER_ID)
    ?? vehicleSystem.getVehicles().values().next().value
    ?? null;

  if (initialVehicle){
    const state = vehicleSystem.getVehicleState(initialVehicle);
    if (state){
      chaseCamera.snapTo(state);
      worldRef.current?.update?.(state.position);
    } else {
      worldRef.current?.update?.(ORIGIN_FALLBACK);
    }
  } else {
    worldRef.current?.update?.(ORIGIN_FALLBACK);
  }

  requestAnimationFrame(animate);
}

window.addEventListener('keydown', (event) => {
  if (event.defaultPrevented) return;
  if (event.code === 'BracketRight'){
    vehicleSystem.cycleActiveVehicle(1);
  } else if (event.code === 'BracketLeft'){
    vehicleSystem.cycleActiveVehicle(-1);
  } else if (event.code === 'KeyF'){
    vehicleSystem.handleFocusShortcut();
  } else if ((event.code === 'Space' || event.code === 'KeyX' || event.code === 'Enter') && !event.repeat){
    setFireSourceActive(event.code, true);
    event.preventDefault();
  }
});

window.addEventListener('keyup', (event) => {
  if (event.code === 'Space' || event.code === 'KeyX' || event.code === 'Enter'){
    setFireSourceActive(event.code, false);
    event.preventDefault();
  }
});

window.addEventListener('mousedown', (event) => {
  if (event.button === 0){
    setFireSourceActive(`mouse-${event.button}`, true);
    event.preventDefault();
  }
});

window.addEventListener('mouseup', (event) => {
  if (event.button === 0){
    setFireSourceActive(`mouse-${event.button}`, false);
    event.preventDefault();
  }
});

window.addEventListener('mouseleave', () => {
  setFireSourceActive('mouse-0', false);
});

window.addEventListener('blur', () => {
  resetFireInput();
});

bootstrap().catch((error) => {
  console.error('Failed to initialize Terra sandbox', error);
});

window.DriftPursuitTerra = {
  join: (id, options) => vehicleSystem.handlePlayerJoin(id, options),
  leave: (id) => vehicleSystem.handlePlayerLeave(id),
  cycle: (delta) => vehicleSystem.cycleActiveVehicle(delta ?? 1),
  focus: () => vehicleSystem.handleFocusShortcut(),
  setActive: (id) => vehicleSystem.setActiveVehicle(id),
  update: (id, snapshot) => vehicleSystem.applyVehicleSnapshot(id, snapshot),
  getTrackedVehicles(){
    return vehicleSystem.getTrackedVehicles();
  },
  fire(){
    return vehicleSystem.fireActiveVehicleProjectile();
  },
  setAmmo(ammoId){
    const accepted = projectileManager.setAmmoType(ammoId);
    if (accepted){
      hud.setActiveAmmo(projectileManager.getCurrentAmmoId());
    }
    return accepted;
  },
  getAmmoTypes(){
    return projectileManager.getAmmoTypes().map(({ id, name, effect }) => ({ id, name, effect }));
  },
};
