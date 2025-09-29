import { TerraWorldStreamer } from './TerraWorldStreamer.js';
import { TileMapWorld } from './TileMapWorld.js';
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

const THREE = requireTHREE();

const MAPS_ENDPOINT = './maps.json';
const DEFAULT_BODY_BACKGROUND = 'linear-gradient(180deg, #79a7ff 0%, #cfe5ff 45%, #f6fbff 100%)';
const DEFAULT_BACKGROUND_COLOR = 0x90b6ff;
const DEFAULT_FOG_COLOR = 0xa4c6ff;
const DEFAULT_FOG_NEAR = 1500;
const DEFAULT_FOG_FAR = 4200;
const DEFAULT_SUN = { color: 0xffffff, intensity: 1.05, position: [-420, 580, 780] };
const DEFAULT_HEMISPHERE = { skyColor: 0xdce9ff, groundColor: 0x2b4a2e, intensity: 0.85 };

const FALLBACK_MAPS = [
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
      fog: { color: '#a4c6ff', near: DEFAULT_FOG_NEAR, far: DEFAULT_FOG_FAR },
      sun: { position: DEFAULT_SUN.position, intensity: DEFAULT_SUN.intensity, color: '#ffffff' },
      hemisphere: { skyColor: '#dce9ff', groundColor: '#2b4a2e', intensity: DEFAULT_HEMISPHERE.intensity },
    },
  },
];

document.body.style.margin = '0';
document.body.style.overflow = 'hidden';
document.body.style.background = DEFAULT_BODY_BACKGROUND;

const renderer = createRenderer();

const scene = new THREE.Scene();
scene.background = new THREE.Color(DEFAULT_BACKGROUND_COLOR);
scene.fog = new THREE.Fog(DEFAULT_FOG_COLOR, DEFAULT_FOG_NEAR, DEFAULT_FOG_FAR);

const camera = createPerspectiveCamera({ fov: 60, near: 0.1, far: 24000 });

const hemisphere = new THREE.HemisphereLight(
  DEFAULT_HEMISPHERE.skyColor,
  DEFAULT_HEMISPHERE.groundColor,
  DEFAULT_HEMISPHERE.intensity,
);
scene.add(hemisphere);

const sun = new THREE.DirectionalLight(DEFAULT_SUN.color, DEFAULT_SUN.intensity);
sun.position.set(
  DEFAULT_SUN.position[0],
  DEFAULT_SUN.position[1],
  DEFAULT_SUN.position[2],
);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -800;
sun.shadow.camera.right = 800;
sun.shadow.camera.top = 800;
sun.shadow.camera.bottom = -800;
sun.shadow.camera.far = 2400;
scene.add(sun);

let world = null;
const collisionSystem = new CollisionSystem({ world: null, crashMargin: 2.4, obstaclePadding: 3.2 });

// 🔧 Standardize on TerraProjectileManager
const projectileManager = new TerraProjectileManager({ scene, world: null });
const ammoPresets = projectileManager.getAmmoTypes();

let availableMaps = [...FALLBACK_MAPS];
let defaultMapId = FALLBACK_MAPS[0]?.id ?? null;
let currentMapDefinition = FALLBACK_MAPS[0] ?? null;

function getRequestedMapId(){
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get('map');
  } catch (error){
    return null;
  }
}

async function loadMapDefinitions(requestedId){
  try {
    const options = requestedId ? { headers: { 'X-Active-Map': requestedId } } : {};
    const response = await fetch(MAPS_ENDPOINT, options);
    if (!response.ok){
      throw new Error(`Failed to fetch maps.json: ${response.status}`);
    }
    const data = await response.json();
    const rawMaps = Array.isArray(data?.maps) ? data.maps : Array.isArray(data) ? data : [];
    const maps = await Promise.all(
      rawMaps.map(async (entry) => {
        const mapEntry = entry ? { ...entry } : null;
        if (!mapEntry) return mapEntry;
        if (mapEntry.type === 'tilemap' && mapEntry.path && typeof fetch === 'function'){
          try {
            const baseUrl = new URL(MAPS_ENDPOINT, window.location.href);
            const descriptorUrl = new URL(mapEntry.path, baseUrl);
            const descriptorResponse = await fetch(descriptorUrl.toString(), { cache: 'no-cache' });
            if (!descriptorResponse.ok){
              console.warn(`Failed to load tile-map descriptor for ${mapEntry.id}: HTTP ${descriptorResponse.status}`);
            } else {
              const descriptor = await descriptorResponse.json();
              mapEntry.descriptor = { ...descriptor };
            }
          } catch (descriptorError){
            console.warn(`Failed to load tile-map descriptor for ${mapEntry.id}`, descriptorError);
          }
        } else if (mapEntry.type === 'tilemap' && mapEntry.descriptor){
          mapEntry.descriptor = { ...mapEntry.descriptor };
        }
        return mapEntry;
      }),
    );
    const defaultId = typeof data?.default === 'string' ? data.default : maps[0]?.id ?? null;
    return { maps, defaultId };
  } catch (error){
    console.warn('Falling back to bundled map definitions.', error);
    return { maps: [...FALLBACK_MAPS], defaultId: defaultMapId };
  }
}

function selectMapDefinition(maps, requestedId, fallbackId){
  const mapList = Array.isArray(maps) && maps.length > 0 ? maps.map((entry) => ({ ...entry })) : [...FALLBACK_MAPS].map((entry) => ({ ...entry }));
  const registry = new Map();
  mapList.forEach((entry) => {
    if (entry?.id){
      registry.set(entry.id, entry);
    }
  });
  let targetId = requestedId && registry.has(requestedId) ? requestedId : null;
  if (!targetId && fallbackId && registry.has(fallbackId)){
    targetId = fallbackId;
  }
  if (!targetId){
    targetId = mapList.find((entry) => entry?.id)?.id ?? FALLBACK_MAPS[0]?.id ?? null;
  }
  const selected = targetId ? registry.get(targetId) ?? mapList[0] : mapList[0];
  return { selected, id: selected?.id ?? targetId ?? null, registry, maps: mapList };
}

function applyMapEnvironment(map){
  const environment = map?.descriptor?.environment ?? map?.environment ?? {};
  document.body.style.background = environment.bodyBackground ?? DEFAULT_BODY_BACKGROUND;
  const background = environment.background ?? DEFAULT_BACKGROUND_COLOR;
  scene.background = new THREE.Color(background);

  const fogConfig = environment.fog ?? {};
  scene.fog.color.set(fogConfig.color ?? DEFAULT_FOG_COLOR);
  scene.fog.near = Number.isFinite(fogConfig.near) ? fogConfig.near : DEFAULT_FOG_NEAR;
  scene.fog.far = Number.isFinite(fogConfig.far) ? fogConfig.far : DEFAULT_FOG_FAR;

  const hemisphereConfig = environment.hemisphere ?? {};
  hemisphere.color.set(hemisphereConfig.skyColor ?? DEFAULT_HEMISPHERE.skyColor);
  hemisphere.groundColor.set(hemisphereConfig.groundColor ?? DEFAULT_HEMISPHERE.groundColor);
  hemisphere.intensity = Number.isFinite(hemisphereConfig.intensity)
    ? hemisphereConfig.intensity
    : DEFAULT_HEMISPHERE.intensity;

  const sunConfig = environment.sun ?? {};
  sun.color.set(sunConfig.color ?? DEFAULT_SUN.color);
  sun.intensity = Number.isFinite(sunConfig.intensity) ? sunConfig.intensity : DEFAULT_SUN.intensity;
  if (sunConfig.position){
    assignVector3(sun.position, sunConfig.position);
  } else {
    sun.position.set(DEFAULT_SUN.position[0], DEFAULT_SUN.position[1], DEFAULT_SUN.position[2]);
  }
}

function initializeWorldForMap(map){
  const mapDefinition = map ?? FALLBACK_MAPS[0];
  if (world){
    world.dispose();
  }
  let descriptor = null;
  if (mapDefinition?.descriptor && typeof mapDefinition.descriptor === 'object'){
    descriptor = { ...mapDefinition.descriptor };
    descriptor.id = descriptor.id ?? mapDefinition.id;
    descriptor.type = descriptor.type ?? mapDefinition.type;
    if (!descriptor.tileSize && Number.isFinite(mapDefinition.tileSize)){
      descriptor.tileSize = mapDefinition.tileSize;
    }
    if (!descriptor.visibleRadius){
      const fallbackRadius = Number.isFinite(mapDefinition.visibleRadius)
        ? mapDefinition.visibleRadius
        : Number.isFinite(mapDefinition.radius)
          ? mapDefinition.radius
          : null;
      if (Number.isFinite(fallbackRadius)){
        descriptor.visibleRadius = fallbackRadius;
      }
    }
  } else if (mapDefinition?.type === 'tilemap'){
    descriptor = { ...mapDefinition };
  }

  if (descriptor?.type === 'tilemap'){
    if (!Array.isArray(descriptor.tiles)){
      descriptor.tiles = Array.isArray(mapDefinition?.tiles) ? [...mapDefinition.tiles] : [];
    }
    if (!descriptor.tileSize){
      descriptor.tileSize = Number.isFinite(mapDefinition?.tileSize)
        ? mapDefinition.tileSize
        : Number.isFinite(mapDefinition?.chunkSize)
          ? mapDefinition.chunkSize
          : 640;
    }
    mapDefinition.descriptor = descriptor;
    world = new TileMapWorld({ scene, descriptor });
  } else {
    const chunkSize = Number.isFinite(mapDefinition?.chunkSize)
      ? mapDefinition.chunkSize
      : Number.isFinite(descriptor?.chunkSize)
        ? descriptor.chunkSize
        : 640;
    const radius = Number.isFinite(mapDefinition?.radius)
      ? mapDefinition.radius
      : Number.isFinite(descriptor?.radius)
        ? descriptor.radius
        : 3;
    const seed = Number.isFinite(mapDefinition?.seed) ? mapDefinition.seed : 982451653;
    world = new TerraWorldStreamer({ scene, chunkSize, radius, seed });
  }
  collisionSystem.setWorld(world);
  projectileManager.setWorld(world);
  applyMapEnvironment(mapDefinition);
  currentMapDefinition = mapDefinition;
}

function handleMapSelect(mapId){
  if (!mapId) return;
  if (currentMapDefinition?.id === mapId) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('map', mapId);
    window.location.href = url.toString();
  } catch (error){
    window.location.search = `?map=${encodeURIComponent(mapId)}`;
  }
}

const chaseCamera = new ChaseCamera(camera, {
  distance: 82,
  height: 28,
  stiffness: 4.2,
  lookStiffness: 6.8,
  forwardResponsiveness: 5.1,
  pitchInfluence: 0.36,
});

const hudPresets = {
  plane: {
    title: 'Spectator (Flight)',
    throttleLabel: 'THR',
    metricLabels: {
      speed: 'Airspeed',
      crashes: 'Incidents',
      time: 'Uptime',
      distance: 'Distance',
    },
    items: [
      { label: 'Cycle', detail: '[ / ] — change player' },
      { label: 'Focus', detail: 'F — snap to focus' },
      { label: 'Fire', detail: 'Click / Space — fire turret' },
    ],
  },
  car: {
    title: 'Spectator (Ground)',
    throttleLabel: 'PWR',
    metricLabels: {
      speed: 'Speed',
      crashes: 'Incidents',
      time: 'Uptime',
      distance: 'Distance',
    },
    items: [
      { label: 'Cycle', detail: '[ / ] — change player' },
      { label: 'Focus', detail: 'F — snap to focus' },
      { label: 'Fire', detail: 'Click / Space — fire turret' },
    ],
  },
};

const hud = new TerraHUD({
  controls: hudPresets.plane,
  ammoOptions: ammoPresets,
  mapOptions: availableMaps,
  onAmmoSelect: (ammoId) => {
    const accepted = projectileManager.setAmmoType(ammoId);
    if (!accepted){
      hud.setActiveAmmo(projectileManager.getCurrentAmmoId());
    }
  },
  onMapSelect: handleMapSelect,
});
hud.setActiveAmmo(projectileManager.getCurrentAmmoId());

const SKY_CEILING = 1800;
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

const vehicles = new Map();
let activeVehicleId = null;

const trackedVehicles = [];

const FIRE_COOLDOWN = 0.35;
const MIN_FAILED_FIRE_DELAY = 0.12;
const activeFireSources = new Set();
let fireInputHeld = false;
let fireCooldownTimer = 0;

function updateTrackedVehicles(){
  trackedVehicles.length = 0;
  for (const [id, vehicle] of vehicles.entries()){
    const state = getVehicleState(vehicle);
    if (!state) continue;
    trackedVehicles.push({ id, mode: vehicle.mode, state });
  }
}

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

function getVehicleState(vehicle){
  if (!vehicle) return null;
  const modeState = vehicle.modes[vehicle.mode];
  if (!modeState) return null;
  if (typeof modeState.controller?.getState !== 'function') return null;
  return modeState.controller.getState();
}

function ensureVehicleVisibility(vehicle){
  if (!vehicle) return;
  const { plane, car } = vehicle.modes;
  if (plane?.mesh) plane.mesh.visible = vehicle.mode === 'plane';
  if (car?.rig?.carMesh) car.rig.carMesh.visible = vehicle.mode === 'car';
}

function switchVehicleMode(vehicle, mode){
  if (!vehicle || !mode) return;
  if (vehicle.mode === mode) return;
  if (!vehicle.modes?.[mode]) return;
  vehicle.mode = mode;
  ensureVehicleVisibility(vehicle);
  if (vehicle.id === activeVehicleId){
    applyHudControls(vehicle);
    focusCameraOnVehicle(vehicle);
  }
}

function applyHudControls(vehicle){
  if (!vehicle) return;
  const preset = hudPresets[vehicle.mode] ?? hudPresets.plane;
  hud.setControls(preset);
}

function assignVector3(target, source){
  if (!target || source == null) return;
  if (Array.isArray(source) && source.length >= 3){
    target.set(source[0], source[1], source[2]);
    return;
  }
  const { x, y, z } = source;
  if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number'){
    target.set(x, y, z);
    return;
  }
  if (typeof x === 'number') target.x = x;
  if (typeof y === 'number') target.y = y;
  if (typeof z === 'number') target.z = z;
}

function assignQuaternion(target, source){
  if (!target || source == null) return;
  if (Array.isArray(source) && source.length >= 4){
    target.set(source[0], source[1], source[2], source[3]);
    return;
  }
  const { x, y, z, w } = source;
  if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number' && typeof w === 'number'){
    target.set(x, y, z, w);
    return;
  }
  if (typeof x === 'number') target.x = x;
  if (typeof y === 'number') target.y = y;
  if (typeof z === 'number') target.z = z;
  if (typeof w === 'number') target.w = w;
}

function syncControllerVisual(controller){
  if (!controller) return;
  if (controller.mesh){
    controller.mesh.position.copy(controller.position);
    controller.mesh.quaternion.copy(controller.orientation);
  }
}

function clampPlaneAltitude(controller, ground){
  if (!controller) return;
  const minAltitude = ground + 16;
  if (controller.position.z < minAltitude){
    controller.position.z = minAltitude;
    if (controller.velocity.z < 0) controller.velocity.z = 0;
  }
  if (controller.position.z > SKY_CEILING){
    controller.position.z = SKY_CEILING;
    if (controller.velocity.z > 0) controller.velocity.z = 0;
  }
}

function computeSpawnTransform(index){
  const angle = index * (Math.PI * 2 / Math.max(1, MAX_DEFAULT_VEHICLES));
  const radius = 420 + (index % 3) * 60;
  const x = Math.cos(angle) * radius;
  const y = Math.sin(angle) * radius;
  const ground = world.getHeightAt(x, y);
  const planePos = new THREE.Vector3(x, y, ground + 60 + (index % 2) * 12);
  const carPos = new THREE.Vector3(x + 28, y - 28, ground + 2.6);
  const yaw = angle + Math.PI / 2;
  return {
    plane: { position: planePos, yaw },
    car: { position: carPos, yaw },
  };
}

function createVehicleEntry(id, { isBot = false, initialMode = 'plane', spawnIndex = vehicles.size } = {}){
  const transform = computeSpawnTransform(spawnIndex);

  const planeMesh = createPlaneMesh();
  scene.add(planeMesh);

  const planeController = new TerraPlaneController();
  planeController.attachMesh(planeMesh, {
    turretYawGroup: planeMesh.userData?.turretYawGroup,
    turretPitchGroup: planeMesh.userData?.turretPitchGroup,
    stickYaw: planeMesh.userData?.turretStickYaw,
    stickPitch: planeMesh.userData?.turretStickPitch,
  });
  planeController.reset({
    position: transform.plane.position,
    yaw: transform.plane.yaw,
    pitch: THREE.MathUtils.degToRad(4),
    throttle: 0.46,
  });

  const carRig = createCarRig();
  scene.add(carRig.carMesh);

  const carController = new CarController();
  carController.attachMesh(carRig.carMesh, {
    stickYaw: carRig.stickYaw,
    stickPitch: carRig.stickPitch,
    towerGroup: carRig.towerGroup,
    towerHead: carRig.towerHead,
    wheels: carRig.wheels,
  });
  carController.reset({
    position: transform.car.position,
    yaw: transform.car.yaw,
  });

  const entry = {
    id,
    isBot,
    mode: initialMode,
    modes: {
      plane: {
        controller: planeController,
        mesh: planeMesh,
        cameraConfig: planeCameraConfig,
        muzzle: planeMesh.userData?.turretMuzzle ?? null,
      },
      car: {
        controller: carController,
        rig: carRig,
        cameraConfig: carCameraConfig,
        muzzle: carRig.carMesh.userData?.turretMuzzle ?? null,
      },
    },
    stats: {
      crashCount: 0,
      elapsed: 0,
      distance: 0,
      throttle: 0,
      speed: 0,
      lastPosition: transform.plane.position.clone(),
    },
    behaviorSeed: Math.random() * Math.PI * 2,
    spawnTransform: {
      plane: {
        position: transform.plane.position.clone(),
        yaw: transform.plane.yaw,
      },
      car: {
        position: transform.car.position.clone(),
        yaw: transform.car.yaw,
      },
    },
  };

  vehicles.set(id, entry);
  ensureVehicleVisibility(entry);
  const initialState = getVehicleState(entry);
  if (initialState?.position){
    entry.stats.lastPosition.copy(initialState.position);
    if (Number.isFinite(initialState.throttle)){
      entry.stats.throttle = initialState.throttle;
    }
    if (Number.isFinite(initialState.speed)){
      entry.stats.speed = initialState.speed;
    }
  }
  return entry;
}

function removeVehicle(id){
  const entry = vehicles.get(id);
  if (!entry) return;
  projectileManager.clearByOwner(id);
  if (entry.modes.plane?.mesh){
    scene.remove(entry.modes.plane.mesh);
  }
  if (entry.modes.car?.rig?.carMesh){
    scene.remove(entry.modes.car.rig.carMesh);
  }
  vehicles.delete(id);
  if (activeVehicleId === id){
    activeVehicleId = null;
  }
}

function countRealPlayers(){
  let count = 0;
  for (const vehicle of vehicles.values()){
    if (!vehicle.isBot) count += 1;
  }
  return count;
}

function selectActiveVehicle(preferredId = null){
  const previous = activeVehicleId;
  if (preferredId && vehicles.has(preferredId)){
    activeVehicleId = preferredId;
  } else if (activeVehicleId && vehicles.has(activeVehicleId)){
    // keep current selection
  } else {
    let fallback = null;
    for (const [id, vehicle] of vehicles.entries()){
      if (!vehicle.isBot){
        activeVehicleId = id;
        fallback = null;
        break;
      }
      if (!fallback) fallback = id;
    }
    if (!vehicles.has(activeVehicleId) && fallback){
      activeVehicleId = fallback;
    }
  }

  if (activeVehicleId && !vehicles.has(activeVehicleId)){
    activeVehicleId = null;
  }
  if (previous !== activeVehicleId){
    const nextVehicle = activeVehicleId ? vehicles.get(activeVehicleId) : null;
    if (nextVehicle){
      focusCameraOnVehicle(nextVehicle);
    }
  }
}

function setActiveVehicle(id){
  if (!id || !vehicles.has(id)) return;
  if (activeVehicleId === id) return;
  activeVehicleId = id;
  focusCameraOnVehicle(vehicles.get(activeVehicleId));
}

function removeOneBot(){
  for (const [id, vehicle] of vehicles.entries()){
    if (vehicle.isBot){
      removeVehicle(id);
      return true;
    }
  }
  return false;
}

function spawnDefaultVehicles(){
  for (let i = 0; i < MAX_DEFAULT_VEHICLES; i += 1){
    const id = `bot-${i + 1}`;
    if (vehicles.has(id)) continue;
    const vehicle = createVehicleEntry(id, { isBot: true, spawnIndex: i });
    vehicle.mode = 'plane';
    ensureVehicleVisibility(vehicle);
  }
  selectActiveVehicle();
}

function handlePlayerJoin(id, options = {}){
  if (!id) return;
  if (vehicles.has(id)) return;
  const vehicle = createVehicleEntry(id, { isBot: !!options.isBot, initialMode: options.initialMode ?? 'plane' });
  if (!vehicle.isBot){
    removeOneBot();
    setActiveVehicle(id);
  } else {
    selectActiveVehicle();
  }
  ensureVehicleVisibility(vehicle);
}

function handlePlayerLeave(id){
  if (!id) return;
  const existed = vehicles.has(id);
  removeVehicle(id);
  if (vehicles.size === 0){
    spawnDefaultVehicles();
  } else if (existed){
    selectActiveVehicle();
  }
}

function resetVehicleStats(vehicle){
  const state = getVehicleState(vehicle);
  if (!state) return;
  vehicle.stats.elapsed = 0;
  vehicle.stats.distance = 0;
  vehicle.stats.lastPosition.copy(state.position);
  vehicle.stats.crashCount = 0;
}

function registerVehicleCrash(vehicle, { message = 'Impact detected' } = {}){
  if (!vehicle) return;
  if (vehicle.stats){
    vehicle.stats.crashCount = (vehicle.stats.crashCount ?? 0) + 1;
  }
  if (message){
    hud.showMessage(message);
  }
  if (vehicle.id === activeVehicleId){
    focusCameraOnVehicle(vehicle);
  }
}

function resetCarAfterCrash(vehicle){
  if (!vehicle) return;
  const spawn = vehicle.spawnTransform?.car;
  const carMode = vehicle.modes?.car;
  if (!spawn || !carMode?.controller) return;
  carMode.controller.reset({ position: spawn.position, yaw: spawn.yaw });
  syncControllerVisual(carMode.controller);
  if (vehicle.stats){
    if (vehicle.stats.lastPosition){
      vehicle.stats.lastPosition.copy(carMode.controller.position);
    } else {
      vehicle.stats.lastPosition = carMode.controller.position.clone();
    }
    vehicle.stats.speed = 0;
    vehicle.stats.throttle = 0;
  }
}

function handleProjectileHit(vehicle, projectile){
  if (!vehicle) return;
  if (projectile?.mesh?.position){
    projectileManager.triggerExplosion({
      position: projectile.mesh.position.clone(),
      ammoId: projectile.ammo?.id ?? null,
    });
  }
  registerVehicleCrash(vehicle, { message: 'Direct hit!' });
  if (vehicle.mode === 'car'){
    resetCarAfterCrash(vehicle);
  }
}

// 🔧 Unified firing uses projectileManager
function fireActiveVehicleProjectile(){
  if (!activeVehicleId) return false;
  const vehicle = vehicles.get(activeVehicleId);
  if (!vehicle) return false;
  const modeName = vehicle.mode;
  const mode = vehicle.modes?.[modeName];
  if (!mode) return false;

  let muzzle = null;
  let controller = mode.controller ?? null;

  if (modeName === 'plane'){
    muzzle = mode.mesh?.userData?.turretMuzzle ?? mode.muzzle ?? null;
  } else if (modeName === 'car'){
    const carMesh = mode.rig?.carMesh ?? null;
    muzzle = carMesh?.userData?.turretMuzzle ?? mode.muzzle ?? null;
  }

  if (!muzzle) return false;

  const inheritVelocity = controller?.velocity ?? null;
  const projectile = projectileManager.spawnFromMuzzle(muzzle, {
    ownerId: vehicle.id,
    inheritVelocity,
  });
  return !!projectile;
}

function updateVehicleStats(vehicle, dt){
  const state = getVehicleState(vehicle);
  if (!state) return;
  const stats = vehicle.stats;
  if (!stats) return;
  stats.elapsed += dt;
  stats.throttle = state.throttle ?? stats.throttle;
  stats.speed = state.speed ?? stats.speed;
  if (stats.lastPosition){
    stats.distance += state.position.distanceTo(stats.lastPosition);
    stats.lastPosition.copy(state.position);
  } else {
    stats.lastPosition = state.position.clone();
  }
}

function updatePlaneBot(vehicle, dt, elapsedTime){
  const controller = vehicle.modes.plane.controller;
  if (!controller) return;
  const oscillation = elapsedTime * 0.35 + vehicle.behaviorSeed;
  const input = {
    pitch: Math.sin(oscillation * 0.9) * 0.24,
    yaw: 0.14 + Math.sin(oscillation * 0.35) * 0.06,
    roll: Math.sin(oscillation * 0.65) * 0.42,
    throttleAdjust: Math.sin(oscillation * 0.18) * 0.05,
    brake: false,
    aim: {
      x: Math.sin(oscillation * 0.52) * 0.65,
      y: Math.cos(oscillation * 0.41) * 0.5,
    },
  };
  controller.update(dt, input, {
    clampAltitude: clampPlaneAltitude,
    sampleGroundHeight: (x, y) => world.getHeightAt(x, y),
  });
}

function updateCarBot(vehicle, dt, elapsedTime){
  const controller = vehicle.modes.car.controller;
  if (!controller) return;
  const oscillation = elapsedTime * 0.6 + vehicle.behaviorSeed;
  const input = {
    throttle: 0.4 + Math.sin(oscillation) * 0.35,
    steer: Math.sin(oscillation * 0.7) * 0.65,
    brake: false,
    aim: {
      x: Math.sin(oscillation * 1.1) * 0.5,
      y: Math.cos(oscillation * 0.9) * 0.35,
    },
  };
  controller.update(dt, input, {
    sampleGroundHeight: (x, y) => world.getHeightAt(x, y),
  });
}

function updateLocalVehicle(vehicle, dt, inputSample){
  if (!vehicle) return;
  const modeRequest = inputSample?.modeRequest;
  if (modeRequest && vehicle.modes?.[modeRequest]){
    switchVehicleMode(vehicle, modeRequest);
    if (vehicle.id === LOCAL_PLAYER_ID && activeVehicleId !== LOCAL_PLAYER_ID){
      setActiveVehicle(LOCAL_PLAYER_ID);
    }
  }

  const currentMode = vehicle.mode;
  if (currentMode === 'plane'){
    const controller = vehicle.modes.plane.controller;
    if (!controller) return;
    const planeInput = inputSample?.plane ?? {};
    controller.update(dt, {
      pitch: planeInput.pitch ?? 0,
      roll: planeInput.roll ?? 0,
      yaw: planeInput.yaw ?? 0,
      throttleAdjust: planeInput.throttleAdjust ?? 0,
      brake: planeInput.brake ?? false,
      aim: planeInput.aim ?? { x: 0, y: 0 },
    }, {
      clampAltitude: clampPlaneAltitude,
      sampleGroundHeight: (x, y) => world.getHeightAt(x, y),
    });
  } else if (currentMode === 'car'){
    const controller = vehicle.modes.car.controller;
    if (!controller) return;
    const carInput = inputSample?.car ?? {};
    controller.update(dt, {
      throttle: carInput.throttle ?? 0,
      steer: carInput.steer ?? 0,
      brake: carInput.brake ?? false,
      aim: carInput.aim ?? { x: 0, y: 0 },
    }, {
      sampleGroundHeight: (x, y) => world.getHeightAt(x, y),
    });
  }
}

function updateVehicleController(vehicle, dt, elapsedTime, inputSample){
  if (!vehicle) return;
  if (vehicle.isBot){
    if (vehicle.mode === 'plane'){
      updatePlaneBot(vehicle, dt, elapsedTime);
    } else {
      updateCarBot(vehicle, dt, elapsedTime);
    }
  } else if (vehicle.id === LOCAL_PLAYER_ID){
    updateLocalVehicle(vehicle, dt, inputSample);
  }
}

function stepVehicleAttachments(vehicle, dt){
  if (!vehicle) return;
  const plane = vehicle.modes?.plane;
  if (plane?.controller?.stepTurretAim){
    plane.controller.stepTurretAim(dt);
  }
}

function applyVehicleSnapshot(id, snapshot = {}){
  const vehicle = vehicles.get(id);
  if (!vehicle) return;
  if (snapshot.mode && vehicle.modes[snapshot.mode]){
    vehicle.mode = snapshot.mode;
    ensureVehicleVisibility(vehicle);
    if (activeVehicleId === id){
      applyHudControls(vehicle);
    }
  }

  const mode = vehicle.modes[vehicle.mode];
  if (!mode) return;
  const controller = mode.controller;
  if (!controller) return;

  if (snapshot.position) assignVector3(controller.position, snapshot.position);
  if (snapshot.velocity) assignVector3(controller.velocity, snapshot.velocity);
  if (snapshot.orientation) assignQuaternion(controller.orientation, snapshot.orientation);
  if (typeof snapshot.speed === 'number') controller.speed = snapshot.speed;
  if (typeof snapshot.throttle === 'number') controller.throttle = snapshot.throttle;
  if (typeof snapshot.targetThrottle === 'number') controller.targetThrottle = snapshot.targetThrottle;

  const planeMode = vehicle.modes?.plane;
  if (planeMode?.controller?.setTurretAimTarget){
    const turretAim = snapshot.planeAim ?? snapshot.aircraftAim ?? snapshot.airAim ?? snapshot.turretAim ?? null;
    if (turretAim){
      planeMode.controller.setTurretAimTarget(turretAim, { immediate: !!snapshot.instantAim });
    }
  }
  if (planeMode?.controller?.setTurretOrientation){
    const turretOrientation = snapshot.turretOrientation ?? snapshot.turretAngles ?? snapshot.turret ?? null;
    if (turretOrientation){
      planeMode.controller.setTurretOrientation(turretOrientation);
    }
  }

  syncControllerVisual(controller);

  if (snapshot.resetStats){
    resetVehicleStats(vehicle);
  } else {
    const state = controller.getState ? controller.getState() : null;
    if (state){
      vehicle.stats.throttle = state.throttle ?? vehicle.stats.throttle;
      vehicle.stats.speed = state.speed ?? vehicle.stats.speed;
      if (!vehicle.stats.lastPosition){
        vehicle.stats.lastPosition = state.position.clone();
      } else {
        vehicle.stats.lastPosition.copy(state.position);
      }
    }
  }
}

function focusCameraOnVehicle(vehicle){
  if (!vehicle) return;
  const mode = vehicle.modes[vehicle.mode];
  if (!mode) return;
  chaseCamera.setConfig(mode.cameraConfig);
  chaseCamera.resetOrbit();
  chaseCamera.snapTo(mode.controller.getState());
  applyHudControls(vehicle);
}

function handleFocusShortcut(){
  if (!activeVehicleId) return;
  const vehicle = vehicles.get(activeVehicleId);
  focusCameraOnVehicle(vehicle);
}

window.addEventListener('keydown', (event) => {
  if (event.defaultPrevented) return;
  if (event.code === 'BracketRight'){
    cycleActiveVehicle(1);
  } else if (event.code === 'BracketLeft'){
    cycleActiveVehicle(-1);
  } else if (event.code === 'KeyF'){
    handleFocusShortcut();
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

function cycleActiveVehicle(delta){
  if (vehicles.size === 0) return;
  const ids = Array.from(vehicles.keys());
  if (ids.length === 0) return;
  if (!activeVehicleId || !vehicles.has(activeVehicleId)){
    selectActiveVehicle();
  }
  const currentIndex = ids.indexOf(activeVehicleId);
  const index = currentIndex === -1 ? 0 : currentIndex;
  let next = (index + delta) % ids.length;
  if (next < 0) next += ids.length;
  const nextId = ids[next];
  if (nextId !== activeVehicleId){
    setActiveVehicle(nextId);
  }
}

enableWindowResizeHandling({ renderer, camera });

function updateHud(vehicle){
  if (!vehicle){
    hud.update({ throttle: 0, speed: 0, crashCount: 0, elapsedTime: 0, distance: 0 });
    return;
  }
  hud.update({
    throttle: vehicle.stats.throttle,
    speed: vehicle.stats.speed,
    crashCount: vehicle.stats.crashCount,
    elapsedTime: vehicle.stats.elapsed,
    distance: vehicle.stats.distance,
  });
}

function evaluateCollisions(vehicle){
  if (!vehicle || vehicle.mode !== 'plane') return;
  const state = getVehicleState(vehicle);
  if (!state) return;
  const result = collisionSystem.evaluate(state);
  if (result.crashed){
    registerVehicleCrash(vehicle, { message: 'Impact detected' });
  }
}

// ⏱️ Main loop

let lastTime = performance.now();
let elapsedTime = 0;

function animate(now){
  requestAnimationFrame(animate);
  const dt = Math.min(0.08, (now - lastTime) / 1000 || 0);
  lastTime = now;
  elapsedTime += dt;

  const inputSample = input.readState(dt);

  for (const vehicle of vehicles.values()){
    updateVehicleController(vehicle, dt, elapsedTime, inputSample);
    stepVehicleAttachments(vehicle, dt);
    updateVehicleStats(vehicle, dt);
  }

  selectActiveVehicle();

  fireCooldownTimer = Math.max(0, fireCooldownTimer - dt);
  if (fireInputHeld && fireCooldownTimer <= 0){
    const fired = fireActiveVehicleProjectile();
    fireCooldownTimer = fired ? FIRE_COOLDOWN : MIN_FAILED_FIRE_DELAY;
  }

  // Projectiles: integrate hits back into your game logic
  projectileManager.update(dt, {
    vehicles,
    onVehicleHit: handleProjectileHit,
    onImpact: (impact) => {
      if (world && typeof world.applyProjectileImpact === 'function'){
        world.applyProjectileImpact(impact);
      }
    },
  });

  const activeVehicle = activeVehicleId ? vehicles.get(activeVehicleId) : null;
  if (activeVehicle && world){
    const state = getVehicleState(activeVehicle);
    if (state){
      chaseCamera.setConfig(activeVehicle.modes[activeVehicle.mode]?.cameraConfig ?? planeCameraConfig);
      chaseCamera.update(state, dt, inputSample?.cameraOrbit ?? null);
      world.update(state.position);
    }
  } else if (world){
    world.update(ORIGIN_FALLBACK);
  }

  evaluateCollisions(activeVehicle);
  updateHud(activeVehicle);
  updateTrackedVehicles();

  renderer.render(scene, camera);
}

async function bootstrap(){
  const requestedId = getRequestedMapId();
  const definition = await loadMapDefinitions(requestedId);
  availableMaps = Array.isArray(definition.maps) && definition.maps.length
    ? definition.maps
    : [...FALLBACK_MAPS];
  defaultMapId = definition.defaultId ?? availableMaps[0]?.id ?? defaultMapId;
  const selection = selectMapDefinition(availableMaps, requestedId, defaultMapId);
  availableMaps = selection.maps;
  defaultMapId = selection.id ?? defaultMapId;
  currentMapDefinition = selection.selected ?? availableMaps[0] ?? FALLBACK_MAPS[0];

  hud.setMapOptions(availableMaps);
  hud.setActiveMap(currentMapDefinition?.id ?? '');

  initializeWorldForMap(currentMapDefinition);

  spawnDefaultVehicles();
  handlePlayerJoin(LOCAL_PLAYER_ID, { initialMode: 'plane' });
  const initialVehicle = activeVehicleId
    ? vehicles.get(activeVehicleId)
    : vehicles.get(LOCAL_PLAYER_ID) ?? vehicles.values().next().value ?? null;
  if (initialVehicle){
    focusCameraOnVehicle(initialVehicle);
    const state = getVehicleState(initialVehicle);
    if (state && world){
      world.update(state.position);
    } else if (world){
      world.update(ORIGIN_FALLBACK);
    }
  } else if (world){
    world.update(ORIGIN_FALLBACK);
  }

  requestAnimationFrame(animate);
}

bootstrap().catch((error) => {
  console.error('Failed to initialize Terra sandbox', error);
});

// 🔧 Public API: rewire to current systems
window.DriftPursuitTerra = {
  join: handlePlayerJoin,
  leave: handlePlayerLeave,
  cycle: cycleActiveVehicle,
  focus: handleFocusShortcut,
  setActive: setActiveVehicle,
  update: applyVehicleSnapshot,
  getTrackedVehicles(){
    return trackedVehicles.map((entry) => ({
      id: entry.id,
      mode: entry.mode,
      position: entry.state.position.clone(),
      velocity: entry.state.velocity.clone(),
    }));
  },
  // fire() now uses the active vehicle’s muzzle via TerraProjectileManager
  fire(){
    return fireActiveVehicleProjectile();
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
