import { WorldStreamer } from '../sandbox/WorldStreamer.js';
import { PlaneController, createPlaneMesh } from '../sandbox/PlaneController.js';
import { CarController, createCarRig } from '../sandbox/CarController.js';
import { ChaseCamera } from '../sandbox/ChaseCamera.js';
import { CollisionSystem } from '../sandbox/CollisionSystem.js';
import { HUD } from '../sandbox/HUD.js';
import {
  createRenderer,
  createPerspectiveCamera,
  enableWindowResizeHandling,
  requireTHREE,
} from '../shared/threeSetup.js';

const THREE = requireTHREE();

document.body.style.margin = '0';
document.body.style.overflow = 'hidden';
document.body.style.background = 'linear-gradient(180deg, #79a7ff 0%, #cfe5ff 45%, #f6fbff 100%)';

const renderer = createRenderer();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x90b6ff);
scene.fog = new THREE.Fog(0xa4c6ff, 1500, 4200);

const camera = createPerspectiveCamera({ fov: 60, near: 0.1, far: 24000 });

const hemisphere = new THREE.HemisphereLight(0xdce9ff, 0x2b4a2e, 0.85);
scene.add(hemisphere);

const sun = new THREE.DirectionalLight(0xffffff, 1.05);
sun.position.set(-420, 580, 780);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -800;
sun.shadow.camera.right = 800;
sun.shadow.camera.top = 800;
sun.shadow.camera.bottom = -800;
sun.shadow.camera.far = 2400;
scene.add(sun);

const world = new WorldStreamer({ scene, chunkSize: 640, radius: 3, seed: 982451653 });
const collisionSystem = new CollisionSystem({ world, crashMargin: 2.4, obstaclePadding: 3.2 });

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
    ],
  },
};

const hud = new HUD({ controls: hudPresets.plane });

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

const vehicles = new Map();
let activeVehicleId = null;

const trackedVehicles = [];

function updateTrackedVehicles(){
  trackedVehicles.length = 0;
  for (const [id, vehicle] of vehicles.entries()){
    const state = getVehicleState(vehicle);
    if (!state) continue;
    trackedVehicles.push({ id, mode: vehicle.mode, state });
  }
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

  const planeController = new PlaneController();
  planeController.attachMesh(planeMesh);
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
      },
      car: {
        controller: carController,
        rig: carRig,
        cameraConfig: carCameraConfig,
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

function updateVehicleController(vehicle, dt, elapsedTime){
  if (!vehicle) return;
  if (vehicle.isBot){
    if (vehicle.mode === 'plane'){
      updatePlaneBot(vehicle, dt, elapsedTime);
    } else {
      updateCarBot(vehicle, dt, elapsedTime);
    }
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
  }
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
    vehicle.stats.crashCount += 1;
    hud.showMessage('Impact detected');
    focusCameraOnVehicle(vehicle);
  }
}

let lastTime = performance.now();
let elapsedTime = 0;

function animate(now){
  requestAnimationFrame(animate);
  const dt = Math.min(0.08, (now - lastTime) / 1000 || 0);
  lastTime = now;
  elapsedTime += dt;

  for (const vehicle of vehicles.values()){
    updateVehicleController(vehicle, dt, elapsedTime);
    updateVehicleStats(vehicle, dt);
  }

  selectActiveVehicle();
  const activeVehicle = activeVehicleId ? vehicles.get(activeVehicleId) : null;
  if (activeVehicle){
    const state = getVehicleState(activeVehicle);
    if (state){
      chaseCamera.setConfig(activeVehicle.modes[activeVehicle.mode]?.cameraConfig ?? planeCameraConfig);
      chaseCamera.update(state, dt, null);
      world.update(state.position);
    }
  } else {
    world.update(new THREE.Vector3(0, 0, 0));
  }

  evaluateCollisions(activeVehicle);
  updateHud(activeVehicle);
  updateTrackedVehicles();

  renderer.render(scene, camera);
}

spawnDefaultVehicles();
focusCameraOnVehicle(activeVehicleId ? vehicles.get(activeVehicleId) : vehicles.values().next().value ?? null);
world.update(new THREE.Vector3(0, 0, 0));
requestAnimationFrame(animate);

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
};
