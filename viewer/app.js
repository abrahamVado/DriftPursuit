// viewer/app.js - minimal three.js viewer that connects to ws://localhost:8080/ws
const HUD = document.getElementById('hud');
const MANUAL_BUTTON = document.getElementById('manual-toggle');
const INVERT_AXES_BUTTON = document.getElementById('invert-axes-toggle');
const ACCELERATE_BUTTON = document.getElementById('accelerate-forward');
const REROUTE_BUTTON = document.getElementById('reroute-waypoints');
const MODEL_SET_SELECT = document.getElementById('model-set-select');
const MODEL_SET_STATUS = document.getElementById('model-set-status');
const MAP_SELECT = document.getElementById('map-select');
const MAP_STATUS = document.getElementById('map-status');
const CONTROL_INSTRUCTIONS_LIST = document.getElementById('control-instructions');

const PLANE_FOLLOW_SELECT = document.getElementById('plane-follow-select');
const PLANE_SELECTOR_STATUS = document.getElementById('plane-selector-status');

const CONNECTION_BANNER = document.getElementById('connection-banner');
const CONNECTION_BANNER_MESSAGE = document.getElementById('connection-banner-message');
const CONNECTION_RECONNECT_BUTTON = document.getElementById('connection-reconnect');

const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';

const PLANE_STALE_TIMEOUT_MS = 5000;
const PLANE_REMOVAL_TIMEOUT_MS = PLANE_STALE_TIMEOUT_MS * 1.5;
const MODEL_SETS = {
  high_fidelity: {
    label: 'High fidelity glTF',
    type: 'gltf',
    path: 'assets/models/high_fidelity_aircraft.gltf',
  },
  stylized_lowpoly: {
    label: 'Stylized low-poly kit',
    type: 'procedural',
    builder: createStylizedLowpolyTemplate,
  },
};
const DEFAULT_MODEL_SET_KEY = 'high_fidelity';
const MODEL_SET_STORAGE_KEY = 'driftpursuit:modelSet';
const INVERT_AXES_STORAGE_KEY = 'driftpursuit:invertAxes';
const MAP_STORAGE_KEY = 'driftpursuit:mapId';
const DEFAULT_MAP_ID = 'procedural:endless';
const modelSetAssetCache = new Map();
let modelSetStorageUnavailable = false;
let runtimeModelSetKey = null;
let currentModelSetKey = resolveModelSetKey();
let currentModelSet = MODEL_SETS[currentModelSetKey] || MODEL_SETS[DEFAULT_MODEL_SET_KEY];
if (!MODEL_SETS[currentModelSetKey]) {
  currentModelSetKey = DEFAULT_MODEL_SET_KEY;
  currentModelSet = MODEL_SETS[DEFAULT_MODEL_SET_KEY];
}
persistModelSetKey(currentModelSetKey);
let invertAxesStorageUnavailable = false;
let invertAxesEnabled = readPersistedInvertAxesPreference();
let mapStorageUnavailable = false;
const MOVEMENT_KEY_CODES = new Set([
  'KeyW','KeyA','KeyS','KeyD',      // planar translation
  'KeyR','KeyF',                    // altitude adjustments
  'Space','ShiftLeft','ShiftRight', // optional vertical control keys
  'KeyQ','KeyE',                    // yaw
  'ArrowUp','ArrowDown',            // pitch
  'ArrowLeft','ArrowRight'          // roll
]);
const TRANSLATION_SPEED = 80; // units/sec (scene coords)
const ALTITUDE_SPEED = 60;
const ROTATION_SPEED = Math.PI / 3; // rad/sec
const MIN_ALTITUDE = 0;
const MAX_ALTITUDE = 400;
const MAX_ROLL = Math.PI * 0.75;
const MAX_PITCH = Math.PI * 0.5;
const ACCELERATION_RATE = 90; // units/sec^2 for forward thrust button
const MAX_FORWARD_SPEED = 260; // max forward velocity when thrust engaged
const NATURAL_DECEL = 35; // drag applied when thrust released
const SCENE_TO_SIM_SCALE = { x: 2, y: 2, z: 50 };
const MANUAL_VELOCITY_EPSILON = 0.5;
const MANUAL_ORIENTATION_EPSILON = 0.005;
const WORLD_CHUNK_SIZE = 900;
const WORLD_CHUNK_RADIUS = 2;
const WORLD_REBASE_DISTANCE = 1200;
const WORLD_REBASE_DISTANCE_SQ = WORLD_REBASE_DISTANCE * WORLD_REBASE_DISTANCE;
const WORLD_SEED = 'driftpursuit:endless';

const CONNECTION_STATUS_KEYS = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
  RECONNECTING: 'reconnecting',
};

const UI_STRINGS = {
  connectionStatus: {
    connecting: {
      label: 'Connecting…',
      banner: 'Attempting to reach the broker.',
    },
    connected: {
      label: 'Connected to broker',
      banner: '',
    },
    disconnected: {
      label: 'Connection lost',
      banner: 'The viewer lost contact with the broker. Try reconnecting.',
    },
    error: {
      label: 'Connection error',
      banner: 'The broker connection encountered an error. Retry when ready.',
    },
    reconnecting: {
      label: 'Reconnecting…',
      banner: 'Trying to restore the connection.',
    },
  },
  buttons: {
    reconnect: 'Reconnect',
  },
};

function getConnectionStatusLabel(statusKey) {
  const statusEntry = UI_STRINGS.connectionStatus[statusKey];
  return statusEntry ? statusEntry.label : 'Connecting…';
}

const manualOverrideStateByPlane = new Map();
const DEFAULT_CONTROL_DOCS = [
  {
    id: 'manual-toggle',
    label: 'Manual Control',
    description: 'Engage viewer-driven control. Keyboard shortcut: press M.'
  },
  {
    id: 'accelerate-forward',
    label: 'Forward Acceleration',
    description: 'Toggle gradual thrust down the runway. Keyboard shortcut: press T.'
  },
  {
    id: 'keyboard',
    label: 'Flight Keys',
    description: 'Use WASD to strafe, RF/Space/Shift to climb or descend, QE for yaw, and arrow keys for pitch/roll.'
  },
  {
    id: 'plane-selector',
    label: 'Tracked Aircraft',
    description: 'Choose the aircraft to follow or press ] and [ to cycle through active planes.'
  },
  {
    id: 'reroute-waypoints',
    label: 'Cycle Autopilot Route',
    description: 'Send preset waypoint loops to the simulator via the set_waypoints command.'
  }
];
let currentControlDocs = DEFAULT_CONTROL_DOCS;

let scene, camera, renderer;
const planeMeshes = new Map();   // id -> THREE.Object3D
const planeLastSeen = new Map(); // id -> timestamp
const followManager = (typeof PlaneState !== 'undefined' && PlaneState && typeof PlaneState.createFollowManager === 'function')
  ? PlaneState.createFollowManager({
      planeLastSeen,
      staleTimeoutMs: PLANE_STALE_TIMEOUT_MS,
      removalTimeoutMs: PLANE_REMOVAL_TIMEOUT_MS,
      nowProvider: () => performance.now(),
    })
  : null;
let currentFollowId = followManager ? followManager.getFollow() : null;
let cakes = {};
let worldManager = null;
let worldOriginOffset = null;

// ----- Aircraft model (optional GLTF or procedural set) -----
let gltfLoader = null;
let gltfLoaderUnavailable = false;
let aircraftLoadError = false;
let aircraftTemplate = null;
let aircraftLoadPromise = null;
const pendingTelemetry = [];
const planeResources = new Map();

// ----- Manual control / HUD state -----
const pressedKeys = new Set();
let manualControlEnabled = false;
let manualMovementActive = false;
let connectionStatusKey = CONNECTION_STATUS_KEYS.CONNECTING;
let connectionStatus = getConnectionStatusLabel(connectionStatusKey);
let lastFrameTime = null;
let accelerationEngaged = false;
let forwardSpeed = 0;
let commandSequence = 0;
let pendingAutopilotPreset = null;
let lastAppliedAutopilotLabel = null;
let nextAutopilotPresetIndex = 0;
let simManualOverrideActive = false;
let lastManualOverridePayload = null;
let lastKnownManualVelocity = [0, 0, 0];
let lastKnownManualOrientation = [0, 0, 0];

// ----- Map & world selection -----
const availableMaps = new Map();
const mapDescriptorCache = new Map();
let runtimeMapId = null;
let currentMapId = DEFAULT_MAP_ID;
let mapBuildToken = 0;

availableMaps.set(DEFAULT_MAP_ID, {
  id: DEFAULT_MAP_ID,
  label: 'Procedural Airstrip',
  type: 'procedural',
  seed: WORLD_SEED,
  chunkSize: WORLD_CHUNK_SIZE,
  visibleRadius: WORLD_CHUNK_RADIUS,
});

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 12000;
const RECONNECT_SPINNER_INTERVAL_MS = 250;
const RECONNECT_SPINNER_FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

let socket = null;
let reconnectAttempt = 0;
let reconnectTimerId = null;
let reconnectCountdownTimerId = null;
let reconnectTargetTimestamp = null;
let reconnectSpinnerIndex = 0;

const CRUISE_SPEED_PRESETS = {
  cruise: { max_speed: 250, acceleration: 18 },
  boost: { max_speed: 290, acceleration: 26 },
};

const AUTOPILOT_PRESETS = [
  {
    label: 'Scenic Runway Loop',
    loop: true,
    arrivalTolerance: 80,
    waypoints: [
      [-800, -400, 1200],
      [-200, 0, 1350],
      [600, 420, 1200],
      [200, -200, 1100],
    ],
  },
  {
    label: 'Harbour Climb',
    loop: true,
    arrivalTolerance: 70,
    waypoints: [
      [-600, -300, 1000],
      [-150, 260, 1500],
      [520, 520, 1400],
      [420, -280, 1050],
    ],
  },
];

if (CONNECTION_RECONNECT_BUTTON){
  CONNECTION_RECONNECT_BUTTON.textContent = UI_STRINGS.buttons.reconnect;
  CONNECTION_RECONNECT_BUTTON.addEventListener('click', () => {
    reconnectToBroker();
  });
}

updateHudStatus();
wireButtonHandlers();
setupModelSetPicker();
setupMapPicker();
setupPlaneSelector();
loadControlDocs();

window.addEventListener('keydown', handleKeyDown);
window.addEventListener('keyup', handleKeyUp);

initThree();
beginAircraftLoad();

connect();


function connect(){
  clearReconnectScheduling();
  const socketInstance = new WebSocket(WS_URL);
  socket = socketInstance;
  const isReconnect = reconnectAttempt > 0;
  connectionStatus = isReconnect ? 'Reconnecting…' : 'Connecting…';
  reconnectSpinnerIndex = 0;
  updateHudStatus();

  socketInstance.addEventListener('open', () => {
    if (socket !== socketInstance) return;
    clearReconnectScheduling();
    reconnectAttempt = 0;
    connectionStatus = 'Connected to broker';
    updateHudStatus();
    syncCruiseControllerTarget({ forceBaseline: true });
    emitManualOverrideSnapshot({ force: true });
  });

  socketInstance.addEventListener('message', (event) => {
    if (socket !== socketInstance) return;
    onSocketMessage(event);
  });

  socketInstance.addEventListener('close', () => {
    if (socket !== socketInstance) return;
    handleSocketInterrupted({ reason: 'closed' });
  });

  socketInstance.addEventListener('error', () => {
    if (socket !== socketInstance) return;
    handleSocketInterrupted({ reason: 'error' });
  });
}

function onSocketMessage(event){
  try {
    const msg = JSON.parse(event.data);
    handleMsg(msg);
  } catch (err) {
    console.warn('bad msg', err);
  }
}

// Small shim so the UI "Reconnect" button still works.
function reconnectToBroker(){
  clearReconnectScheduling();
  connect();
}

function handleSocketInterrupted(options = {}){
  const wasAlreadyScheduled = Boolean(reconnectTimerId);
  socket = null;
  const reason = options.reason === 'error' ? 'Connection error' : 'Connection lost';
  connectionStatus = `${reason}. Reconnecting…`;
  updateHudStatus();
  resetManualStateForReconnect();
  if (!wasAlreadyScheduled){
    scheduleReconnect();
  }
}

function resetManualStateForReconnect(){
  pressedKeys.clear();
  setManualMovementActive(false);
  if (accelerationEngaged){
    setAccelerationEngaged(false, { skipManualEnforce: true, skipCruiseSync: true });
  }
  forwardSpeed = 0;
  lastManualOverridePayload = null;
  lastKnownManualVelocity = [0, 0, 0];
  updateHudStatus();
}

function scheduleReconnect(){
  if (reconnectTimerId) return;
  reconnectAttempt += 1;
  const delay = computeReconnectDelay(reconnectAttempt);
  reconnectTargetTimestamp = Date.now() + delay;
  updateReconnectCountdownStatus(true);
  reconnectTimerId = window.setTimeout(() => {
    clearReconnectScheduling();
    connect();
  }, delay);
  reconnectCountdownTimerId = window.setInterval(() => {
    updateReconnectCountdownStatus();
  }, RECONNECT_SPINNER_INTERVAL_MS);
}

function clearReconnectScheduling(){
  if (reconnectTimerId){
    window.clearTimeout(reconnectTimerId);
    reconnectTimerId = null;
  }
  if (reconnectCountdownTimerId){
    window.clearInterval(reconnectCountdownTimerId);
    reconnectCountdownTimerId = null;
  }
  reconnectTargetTimestamp = null;
}

function updateReconnectCountdownStatus(force){
  if (force){
    reconnectSpinnerIndex = 0;
  }

  if (!reconnectTargetTimestamp){
    connectionStatus = 'Reconnecting…';
  } else {
    const now = Date.now();
    const remainingMs = Math.max(0, reconnectTargetTimestamp - now);
    const spinner = RECONNECT_SPINNER_FRAMES[reconnectSpinnerIndex % RECONNECT_SPINNER_FRAMES.length];
    reconnectSpinnerIndex = (reconnectSpinnerIndex + 1) % RECONNECT_SPINNER_FRAMES.length;
    if (remainingMs <= 0){
      connectionStatus = `${spinner} Reconnecting…`;
    } else {
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      connectionStatus = `${spinner} Reconnecting in ${remainingSeconds}s (attempt ${reconnectAttempt})…`;
    }
  }

  updateHudStatus();
}

function computeReconnectDelay(attempt){
  const exponent = Math.max(0, attempt - 1);
  const delay = RECONNECT_BASE_DELAY_MS * Math.pow(1.5, exponent);
  return Math.min(RECONNECT_MAX_DELAY_MS, Math.round(delay));
}


function handleMsg(msg){
  if (msg.type === 'telemetry'){
    const id = msg.id;
    const p = msg.pos || [0,0,0];
    const tags = Array.isArray(msg.tags) ? msg.tags : [];
    updateManualOverrideIndicator(id, tags.includes('manual:override'));

    if (!aircraftTemplate && !aircraftLoadError){
      pendingTelemetry.push(msg);
      beginAircraftLoad();
      return;
    }

    let mesh = planeMeshes.get(id);
    if (!mesh){
      const { object, geometries, materials, textures } = createAircraftInstance();
      mesh = object;
      planeMeshes.set(id, mesh);
      planeResources.set(id, { geometries, materials, textures });
      scene.add(mesh);
    }

    const now = performance.now();
    let planeSeenResult = { isNew: false, followChanged: false, statusChanged: false };
    if (followManager){
      planeSeenResult = followManager.onPlaneSeen(id, now) || planeSeenResult;
      syncFollowState();
    } else {
      planeLastSeen.set(id, now);
      if (!currentFollowId){
        currentFollowId = id;
        refreshSimManualOverrideState();
      }
    }

    const followId = getCurrentFollowId();
    const targetPosition = convertSimPositionToScene(p);

    // optional orientation: [yaw, pitch, roll]
    const o = msg.ori;
    const shouldApplyTelemetry = !(manualControlEnabled && followId === id);

    if (shouldApplyTelemetry){
      // update position (map sim coords to scene; z up)
      mesh.position.copy(targetPosition);

      if (Array.isArray(o) && o.length === 3){
        const [yaw, pitch, roll] = o;
        // Using ZYX order: yaw (Z), pitch (Y), roll (X)
        const euler = new THREE.Euler(roll, pitch, yaw, 'ZYX');
        mesh.setRotationFromEuler(euler);
      }
    }

    // update camera only if we're following this plane and telemetry was applied
    if (followId === id && shouldApplyTelemetry) updateCameraTarget(mesh);

    if (followManager){
      if (planeSeenResult.isNew || planeSeenResult.statusChanged || planeSeenResult.followChanged){
        refreshPlaneSelector();
      }
    } else {
      refreshPlaneSelector();
    }

  } else if (msg.type === 'cake_drop'){
    // create simple sphere at landing_pos and remove after a while
    const id = msg.id;
    const lp = msg.landing_pos || msg.pos || [0,0,0];
    const geom = new THREE.SphereGeometry(3,12,12);
    const mat = new THREE.MeshStandardMaterial({color:0xffcc66});
    const s = new THREE.Mesh(geom, mat);
    const landingPosition = convertSimPositionToScene(lp);
    s.position.copy(landingPosition);
    scene.add(s);
    cakes[id] = s;
    setTimeout(()=>{ scene.remove(s); delete cakes[id]; }, 8000);
  } else if (msg.type === 'command_status') {
    handleCommandStatus(msg);
  }
}

function nextCommandId(){
  commandSequence += 1;
  return `viewer-${commandSequence}`;
}

function sendSimCommand(cmd, params = {}, options = {}){
  if (!socket || socket.readyState !== WebSocket.OPEN){
    console.warn('Cannot send command; socket not open');
    return null;
  }

  const includeCommandId = options.includeCommandId !== false;
  const commandId = includeCommandId ? nextCommandId() : null;
  const targetFollowId = options.targetId || getCurrentFollowId();
  const payload = {
    type: 'command',
    cmd,
    from: options.from || 'viewer-ui',
    target_id: targetFollowId || 'plane-1',
    params,
  };
  payload.id = payload.target_id;
  if (includeCommandId){
    payload.command_id = commandId;
  }

  try {
    socket.send(JSON.stringify(payload));
    console.log('Sent command', payload);
    return commandId;
  } catch (err) {
    console.warn('Failed to send command', err);
    return null;
  }
}

function handleCommandStatus(msg){
  const { cmd, status, detail } = msg;
  const logPrefix = status === 'ok' ? 'Command succeeded' : 'Command failed';
  console.log(`${logPrefix}: ${cmd}`, msg);
  if (status === 'error' && detail){
    console.warn('Command detail:', detail);
  }

  if (cmd === 'set_waypoints'){
    if (pendingAutopilotPreset && msg.command_id === pendingAutopilotPreset.commandId){
      if (status === 'ok'){
        lastAppliedAutopilotLabel = pendingAutopilotPreset.label;
        nextAutopilotPresetIndex = (pendingAutopilotPreset.index + 1) % AUTOPILOT_PRESETS.length;
      }
      pendingAutopilotPreset = null;
      updateRerouteButtonState();
    }
  }

  if (cmd === 'set_speed' && status === 'error'){
    // Re-send baseline cruise settings so the aircraft continues smoothly.
    syncCruiseControllerTarget({ forceBaseline: true });
  }
}

function updateRerouteButtonState(){
  if (!REROUTE_BUTTON) return;
  let label = 'Cycle Autopilot Route';
  if (pendingAutopilotPreset){
    label = `Routing… ${pendingAutopilotPreset.label}`;
    REROUTE_BUTTON.classList.add('is-active');
  } else {
    REROUTE_BUTTON.classList.remove('is-active');
    if (lastAppliedAutopilotLabel){
      label = `Route: ${lastAppliedAutopilotLabel} · Cycle Autopilot Route`;
    }
  }
  REROUTE_BUTTON.textContent = label;
}

function cycleAutopilotWaypoints(){
  if (pendingAutopilotPreset){
    console.warn('Autopilot command already pending');
    return;
  }
  if (!AUTOPILOT_PRESETS.length){
    console.warn('No autopilot presets available');
    return;
  }
  const preset = AUTOPILOT_PRESETS[nextAutopilotPresetIndex];
  const commandId = sendSimCommand('set_waypoints', {
    waypoints: preset.waypoints,
    loop: preset.loop,
    arrival_tolerance: preset.arrivalTolerance,
  });
  if (commandId){
    pendingAutopilotPreset = {
      commandId,
      label: preset.label,
      index: nextAutopilotPresetIndex,
    };
    updateRerouteButtonState();
  }
}

function syncCruiseControllerTarget(options = {}){
  const preset = options.forceBaseline || !accelerationEngaged
    ? CRUISE_SPEED_PRESETS.cruise
    : CRUISE_SPEED_PRESETS.boost;
  if (!preset) return;
  sendSimCommand('set_speed', {
    max_speed: preset.max_speed,
    acceleration: preset.acceleration,
  });
}

function beginAircraftLoad(){
  const activeKey = currentModelSetKey;
  currentModelSet = MODEL_SETS[activeKey] || MODEL_SETS[DEFAULT_MODEL_SET_KEY];

  if (!currentModelSet){
    aircraftLoadError = true;
    flushPendingTelemetry();
    updateHudStatus();
    return null;
  }

  if (aircraftTemplate && !aircraftLoadError){
    const cachedTemplate = modelSetAssetCache.get(activeKey);
    if (!cachedTemplate || cachedTemplate.template !== aircraftTemplate){
      modelSetAssetCache.set(activeKey, { template: aircraftTemplate });
    }
    updateHudStatus();
    return Promise.resolve(aircraftTemplate);
  }

  const cached = modelSetAssetCache.get(activeKey);
  if (cached?.template){
    aircraftTemplate = cached.template;
    aircraftLoadError = false;
    rebuildActiveAircraftInstances();
    flushPendingTelemetry();
    updateHudStatus();
    return Promise.resolve(aircraftTemplate);
  }

  if (cached?.promise){
    aircraftLoadPromise = cached.promise;
    return aircraftLoadPromise;
  }

  let loadPromise;
  if (currentModelSet.type === 'gltf') {
    const loader = ensureGltfLoader();
    if (!loader){
      aircraftLoadError = true;
      modelSetAssetCache.set(activeKey, { error: new Error('GLTFLoader unavailable') });
      flushPendingTelemetry();
      updateHudStatus();
      return null;
    }
    loadPromise = new Promise((resolve, reject) => {
      loader.load(currentModelSet.path, (gltf) => {
        resolve(prepareAircraftTemplate(gltf.scene));
      }, undefined, (err) => reject(err));
    });
  } else if (currentModelSet.type === 'procedural') {
    loadPromise = new Promise((resolve, reject) => {
      try {
        resolve(prepareAircraftTemplate(currentModelSet.builder()));
      } catch (builderErr) {
        reject(builderErr);
      }
    });
  } else {
    aircraftLoadError = true;
    modelSetAssetCache.set(activeKey, { error: new Error('Unsupported model set type') });
    flushPendingTelemetry();
    updateHudStatus();
    return null;
  }

  const trackedPromise = loadPromise.then((template) => {
    modelSetAssetCache.set(activeKey, { template });
    if (currentModelSetKey === activeKey){
      aircraftTemplate = template;
      aircraftLoadError = false;
      rebuildActiveAircraftInstances();
      flushPendingTelemetry();
      updateHudStatus();
    }
    return template;
  }).catch((err) => {
    console.error('Failed to load aircraft model', err);
    modelSetAssetCache.set(activeKey, { error: err });
    if (currentModelSetKey === activeKey){
      aircraftLoadError = true;
      flushPendingTelemetry();
      updateHudStatus();
    }
    throw err;
  }).finally(() => {
    if (currentModelSetKey === activeKey){
      aircraftLoadPromise = null;
    }
  });

  modelSetAssetCache.set(activeKey, { promise: trackedPromise });
  if (currentModelSetKey === activeKey){
    aircraftLoadPromise = trackedPromise;
  }
  updateHudStatus();
  return trackedPromise;
}

function flushPendingTelemetry(){
  if (!pendingTelemetry.length) return;
  const queued = pendingTelemetry.splice(0, pendingTelemetry.length);
  queued.forEach((queuedMsg) => handleMsg(queuedMsg));
}

function ensureGltfLoader(){
  if (gltfLoader) return gltfLoader;
  if (gltfLoaderUnavailable) return null;
  try {
    if (typeof THREE !== 'undefined' && typeof THREE.GLTFLoader === 'function') {
      gltfLoader = new THREE.GLTFLoader();
      return gltfLoader;
    }
    console.warn('GLTFLoader not found; using fallback mesh.');
  } catch (err) {
    console.warn('Failed to init GLTFLoader; using fallback mesh.', err);
  }
  gltfLoaderUnavailable = true;
  return null;
}

function rebuildActiveAircraftInstances(){
  if (!aircraftTemplate || aircraftLoadError || !scene) return;
  planeMeshes.forEach((mesh, id) => {
    if (!mesh) return;
    const previousPosition = mesh.position.clone();
    const previousQuaternion = mesh.quaternion.clone();
    const previousScale = mesh.scale.clone();

    scene.remove(mesh);
    disposePlaneResources(id);

    const { object, geometries, materials, textures } = createAircraftInstance();
    object.position.copy(previousPosition);
    object.quaternion.copy(previousQuaternion);
    object.scale.copy(previousScale);

    planeMeshes.set(id, object);
    planeResources.set(id, { geometries, materials, textures });
    scene.add(object);
  });
}

function prepareAircraftTemplate(root){
  if (!root) throw new Error('Invalid aircraft template root');
  root.traverse?.((node) => {
    if (node.isMesh){
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  return root;
}

function createAircraftInstance(){
  if (!aircraftTemplate){
    return createFallbackInstance();
  }
  const clone = aircraftTemplate.clone(true);
  const geometries = [];
  const materials = [];
  const textures = [];

  clone.traverse((node) => {
    if (node.isMesh){
      if (node.geometry){
        const clonedGeometry = node.geometry.clone();
        node.geometry = clonedGeometry;
        geometries.push(clonedGeometry);
      }
      if (node.material){
        if (Array.isArray(node.material)){
          node.material = node.material.map((mat) => {
            const clonedMaterial = mat.clone();
            clonedMaterial.metalness = mat.metalness ?? 0.2;
            clonedMaterial.roughness = mat.roughness ?? 0.55;
            materials.push(clonedMaterial);
            captureMaterialTextures(clonedMaterial, textures);
            return clonedMaterial;
          });
        } else {
          const baseMaterial = node.material;
          const clonedMaterial = baseMaterial.clone();
          clonedMaterial.metalness = baseMaterial.metalness ?? 0.2;
          clonedMaterial.roughness = baseMaterial.roughness ?? 0.55;
          node.material = clonedMaterial;
          materials.push(clonedMaterial);
          captureMaterialTextures(clonedMaterial, textures);
        }
      } else {
        const fallbackMaterial = new THREE.MeshStandardMaterial({color:0x355ad6, metalness:0.25, roughness:0.6});
        node.material = fallbackMaterial;
        materials.push(fallbackMaterial);
      }
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });

  clone.scale.set(0.25, 0.25, 0.25);
  clone.name = 'AircraftInstance';
  return { object: clone, geometries, materials, textures };
}

function createFallbackInstance(){
  const group = new THREE.Group();
  const geometries = [];
  const materials = [];

  const CapsuleCtor = typeof THREE.CapsuleGeometry === 'function' ? THREE.CapsuleGeometry : null;
  const fuselageGeometry = CapsuleCtor
    ? new CapsuleCtor(3, 16, 8, 16)
    : new THREE.CylinderGeometry(3.2, 3.2, 22, 16);
  const fuselageMaterial = new THREE.MeshStandardMaterial({ color: 0x3a60f4, metalness: 0.35, roughness: 0.45 });
  const fuselage = new THREE.Mesh(fuselageGeometry, fuselageMaterial);
  fuselage.rotation.z = Math.PI / 2;
  fuselage.castShadow = true;
  fuselage.receiveShadow = true;
  group.add(fuselage);
  geometries.push(fuselageGeometry);
  materials.push(fuselageMaterial);

  const canopyGeometry = new THREE.CylinderGeometry(2.4, 1.6, 6, 16);
  const canopyMaterial = new THREE.MeshStandardMaterial({ color: 0x7fbef5, transparent: true, opacity: 0.7, metalness: 0.2, roughness: 0.1 });
  const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
  canopy.rotation.z = Math.PI / 2;
  canopy.position.set(3, 0, 1.2);
  canopy.castShadow = true;
  group.add(canopy);
  geometries.push(canopyGeometry);
  materials.push(canopyMaterial);

  const wingMaterial = new THREE.MeshStandardMaterial({ color: 0xf2cf63, roughness: 0.55, metalness: 0.12 });
  const mainWingGeometry = new THREE.BoxGeometry(20, 2, 0.8);
  const mainWing = new THREE.Mesh(mainWingGeometry, wingMaterial);
  mainWing.position.set(0, 0, -0.6);
  mainWing.castShadow = true;
  mainWing.receiveShadow = true;
  group.add(mainWing);
  geometries.push(mainWingGeometry);
  materials.push(wingMaterial);

  const tailWingGeometry = new THREE.BoxGeometry(8, 1.8, 0.5);
  const tailWing = new THREE.Mesh(tailWingGeometry, wingMaterial);
  tailWing.position.set(-6.5, 0, -0.2);
  tailWing.castShadow = true;
  tailWing.receiveShadow = true;
  group.add(tailWing);
  geometries.push(tailWingGeometry);

  const verticalStabGeometry = new THREE.BoxGeometry(0.8, 2.6, 3.2);
  const verticalStabMaterial = new THREE.MeshStandardMaterial({ color: 0xff8e4d, roughness: 0.5, metalness: 0.1 });
  const verticalStab = new THREE.Mesh(verticalStabGeometry, verticalStabMaterial);
  verticalStab.position.set(-7.2, 0, 2.0);
  verticalStab.castShadow = true;
  verticalStab.receiveShadow = true;
  group.add(verticalStab);
  geometries.push(verticalStabGeometry);
  materials.push(verticalStabMaterial);

  const propellerGeometry = new THREE.BoxGeometry(0.6, 12, 0.4);
  const propellerMaterial = new THREE.MeshStandardMaterial({ color: 0x1f1f1f, roughness: 0.4, metalness: 0.3 });
  const propeller = new THREE.Mesh(propellerGeometry, propellerMaterial);
  propeller.position.set(11.5, 0, 0);
  propeller.castShadow = true;
  group.add(propeller);
  geometries.push(propellerGeometry);
  materials.push(propellerMaterial);

  group.scale.set(0.25, 0.25, 0.25);
  group.name = 'FallbackAircraft';

  group.traverse((node) => {
    if (node.isMesh){
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });

  return { object: group, geometries, materials, textures: [] };
}

function disposePlaneResources(id){
  const resources = planeResources.get(id);
  if (resources){
    if (Array.isArray(resources.geometries)){
      resources.geometries.forEach((g) => g?.dispose && g.dispose());
    }
    if (Array.isArray(resources.materials)){
      resources.materials.forEach((m) => {
        if (!m) return;
        if (Array.isArray(m)) m.forEach((mm)=>mm?.dispose && mm.dispose());
        else if (m.dispose) m.dispose();
      });
    }
    if (Array.isArray(resources.textures)){
      resources.textures.forEach((t) => t?.dispose && t.dispose());
    }
  }
  planeResources.delete(id);
}

function captureMaterialTextures(material, textures){
  if (!material) return;
  const keys = ['map','normalMap','metalnessMap','roughnessMap','aoMap','emissiveMap','alphaMap','envMap'];
  keys.forEach((key) => {
    const tex = material[key];
    if (tex){
      const cloned = (typeof tex.clone === 'function') ? tex.clone() : tex;
      material[key] = cloned;
      textures.push(cloned);
    }
  });
}

function buildEnvironment(targetScene){
  if (!targetScene) return;
  rebuildWorldForCurrentMap({ force: true });
}

function createEndlessWorld({ scene: targetScene, chunkSize, visibleRadius, seed }){
  if (!targetScene || !chunkSize || !visibleRadius) return null;

  const worldRoot = new THREE.Group();
  worldRoot.name = 'EndlessWorldRoot';
  targetScene.add(worldRoot);

  const chunkMap = new Map();

  function update(focusPosition){
    if (!focusPosition) return;
    const originOffset = ensureWorldOriginOffset();
    const focusGlobal = focusPosition.clone().add(originOffset);
    const centerChunkX = Math.floor(focusGlobal.x / chunkSize);
    const centerChunkY = Math.floor(focusGlobal.y / chunkSize);
    const needed = new Set();

    for (let dx = -visibleRadius; dx <= visibleRadius; dx += 1){
      for (let dy = -visibleRadius; dy <= visibleRadius; dy += 1){
        const chunkX = centerChunkX + dx;
        const chunkY = centerChunkY + dy;
        const key = chunkKey(chunkX, chunkY);
        needed.add(key);
        let chunkEntry = chunkMap.get(key);
        if (!chunkEntry){
          chunkEntry = spawnChunk(chunkX, chunkY);
          chunkMap.set(key, chunkEntry);
          worldRoot.add(chunkEntry.group);
        }
        positionChunk(chunkEntry);
      }
    }

    chunkMap.forEach((chunkEntry, key) => {
      if (!needed.has(key)){
        disposeChunk(chunkEntry);
        chunkMap.delete(key);
      }
    });
  }

  function spawnChunk(x, y){
    const coords = { x, y };
    const rng = createSeededRng(seed || 'default', x, y);
    const { group, disposables } = buildChunkContents({ coords, chunkSize, rng });
    group.name = `WorldChunk_${x}_${y}`;
    positionChunk({ coords, group });
    return { coords, group, disposables };
  }

  function positionChunk(chunkEntry){
    if (!chunkEntry || !chunkEntry.group) return;
    const originOffset = ensureWorldOriginOffset();
    const worldX = chunkEntry.coords.x * chunkSize;
    const worldY = chunkEntry.coords.y * chunkSize;
    chunkEntry.group.position.set(worldX - originOffset.x, worldY - originOffset.y, -originOffset.z);
  }

  function handleOriginShift(shift){
    if (!shift) return;
    chunkMap.forEach((chunkEntry) => {
      if (chunkEntry?.group?.position){
        chunkEntry.group.position.sub(shift);
      }
    });
  }

  function disposeChunk(chunkEntry){
    if (!chunkEntry) return;
    if (chunkEntry.group){
      worldRoot.remove(chunkEntry.group);
      if (typeof chunkEntry.group.clear === 'function'){
        chunkEntry.group.clear();
      }
    }
    if (Array.isArray(chunkEntry.disposables)){
      chunkEntry.disposables.forEach((resource) => {
        if (resource && typeof resource.dispose === 'function'){
          resource.dispose();
        }
      });
    }
  }

  function disposeAll(){
    chunkMap.forEach((chunkEntry) => disposeChunk(chunkEntry));
    chunkMap.clear();
    targetScene.remove(worldRoot);
  }

  return { update, handleOriginShift, dispose: disposeAll };
}

function buildChunkContents({ coords, chunkSize, rng }){
  const group = new THREE.Group();
  const disposables = [];

  const baseHue = 0.33 + (rng() - 0.5) * 0.04;
  const baseSaturation = 0.55 + (rng() - 0.5) * 0.08;
  const baseLightness = 0.53 + (rng() - 0.5) * 0.08;
  const groundColor = new THREE.Color().setHSL(baseHue, baseSaturation, baseLightness);
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: groundColor,
    roughness: 0.85,
    metalness: 0.05,
  });
  const groundGeometry = new THREE.PlaneGeometry(chunkSize, chunkSize, 1, 1);
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  disposables.push(groundMaterial, groundGeometry);

  // Add subtle tonal overlays to break tiling repetition without seams.
  const overlayCount = 2;
  for (let i = 0; i < overlayCount; i += 1){
    const overlayWidth = chunkSize * (0.55 + rng() * 0.25);
    const overlayDepth = chunkSize * (0.08 + rng() * 0.04);
    const overlayGeometry = new THREE.PlaneGeometry(overlayWidth, overlayDepth, 1, 1);
    const overlayMaterial = new THREE.MeshStandardMaterial({
      color: groundColor.clone().offsetHSL((rng() - 0.5) * 0.04, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.08),
      roughness: 0.75,
      metalness: 0.04,
      transparent: true,
      opacity: 0.4,
    });
    const overlay = new THREE.Mesh(overlayGeometry, overlayMaterial);
    overlay.rotation.x = -Math.PI / 2;
    overlay.position.set((rng() - 0.5) * chunkSize * 0.4, (rng() - 0.5) * chunkSize * 0.4, 0.08 + rng() * 0.02);
    overlay.receiveShadow = true;
    group.add(overlay);
    disposables.push(overlayMaterial, overlayGeometry);
  }

  if (Math.abs(coords.x) <= 1){
    addRunwaySegment(group, chunkSize, rng, disposables);
  }

  const scatterCount = 6 + Math.floor(rng() * 6);
  for (let i = 0; i < scatterCount; i += 1){
    const localX = (rng() - 0.5) * chunkSize * 0.9;
    const localY = (rng() - 0.5) * chunkSize * 0.9;
    if (Math.abs(coords.x) <= 1 && Math.abs(localX) < 130){
      continue; // keep runway shoulders clear
    }
    if (rng() > 0.7){
      const building = createProceduralBuilding({ rng, position: { x: localX, y: localY } });
      group.add(building.object);
      disposables.push(...building.disposables);
    } else {
      const tree = createProceduralTree({ rng, position: { x: localX, y: localY } });
      group.add(tree.object);
      disposables.push(...tree.disposables);
    }
  }

  return { group, disposables };
}

function addRunwaySegment(group, chunkSize, rng, disposables){
  const runwayMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.72, metalness: 0.12 });
  const runwayGeometry = new THREE.PlaneGeometry(chunkSize, 180, 1, 1);
  const runway = new THREE.Mesh(runwayGeometry, runwayMaterial);
  runway.rotation.x = -Math.PI / 2;
  runway.position.set(0, 0, 0.12);
  runway.receiveShadow = true;
  group.add(runway);
  disposables.push(runwayMaterial, runwayGeometry);

  const shoulderMaterial = new THREE.MeshStandardMaterial({ color: 0x515865, roughness: 0.62, metalness: 0.08 });
  const shoulderGeometry = new THREE.PlaneGeometry(chunkSize, 26, 1, 1);
  const leftShoulder = new THREE.Mesh(shoulderGeometry, shoulderMaterial);
  const rightShoulder = new THREE.Mesh(shoulderGeometry, shoulderMaterial);
  leftShoulder.rotation.x = -Math.PI / 2;
  rightShoulder.rotation.x = -Math.PI / 2;
  leftShoulder.position.set(0, -110, 0.13);
  rightShoulder.position.set(0, 110, 0.13);
  leftShoulder.receiveShadow = true;
  rightShoulder.receiveShadow = true;
  group.add(leftShoulder, rightShoulder);
  disposables.push(shoulderMaterial, shoulderGeometry);

  const markerMaterial = new THREE.MeshStandardMaterial({ color: 0xf7f7f7, roughness: 0.35, metalness: 0.05 });
  const markerGeometry = new THREE.PlaneGeometry(60, 8, 1, 1);
  const markerCount = 5;
  for (let i = -markerCount; i <= markerCount; i += 1){
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(0, (i / markerCount) * (chunkSize * 0.5), 0.14);
    marker.receiveShadow = true;
    group.add(marker);
  }
  disposables.push(markerMaterial, markerGeometry);

  if (rng() > 0.6){
    const centerGlowMaterial = new THREE.MeshStandardMaterial({ color: 0xf5d46b, emissive: new THREE.Color(0xf5d46b), emissiveIntensity: 0.35, roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0.25 });
    const centerGlowGeometry = new THREE.PlaneGeometry(chunkSize * 0.2, 40, 1, 1);
    const centerGlow = new THREE.Mesh(centerGlowGeometry, centerGlowMaterial);
    centerGlow.rotation.x = -Math.PI / 2;
    centerGlow.position.set(0, 0, 0.15);
    group.add(centerGlow);
    disposables.push(centerGlowMaterial, centerGlowGeometry);
  }
}

function createProceduralTree({ rng, position }){
  const tree = new THREE.Group();
  tree.name = 'ProceduralTree';
  tree.position.set(position.x, position.y, 0);
  const disposables = [];

  const trunkHeight = 12 + rng() * 10;
  const trunkRadiusTop = 1.2 + rng() * 0.8;
  const trunkRadiusBottom = trunkRadiusTop + 0.6 + rng() * 0.6;
  const trunkGeometry = new THREE.CylinderGeometry(trunkRadiusTop, trunkRadiusBottom, trunkHeight, 6);
  const trunkMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.09 + rng() * 0.02, 0.6, 0.32 + rng() * 0.1),
    roughness: 0.82,
  });
  const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
  trunk.position.set(0, 0, trunkHeight / 2);
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  tree.add(trunk);
  disposables.push(trunkGeometry, trunkMaterial);

  const foliageHeight = trunkHeight * (1.35 + rng() * 0.3);
  const foliageRadius = trunkHeight * (0.9 + rng() * 0.2);
  const foliageGeometry = new THREE.ConeGeometry(foliageRadius, foliageHeight, 10);
  const foliageMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.33 + rng() * 0.05, 0.72, 0.38 + rng() * 0.1),
    roughness: 0.6,
    metalness: 0.05,
  });
  const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
  foliage.position.set(0, 0, trunkHeight + foliageHeight / 2);
  foliage.castShadow = true;
  foliage.receiveShadow = true;
  tree.add(foliage);
  disposables.push(foliageGeometry, foliageMaterial);

  tree.rotation.z = (rng() - 0.5) * 0.2;
  tree.rotation.y = rng() * Math.PI * 2;

  return { object: tree, disposables };
}

function createProceduralBuilding({ rng, position }){
  const building = new THREE.Group();
  building.name = 'ProceduralBuilding';
  building.position.set(position.x, position.y, 0);
  const disposables = [];

  const baseWidth = 40 + rng() * 36;
  const baseDepth = 40 + rng() * 36;
  const baseHeight = 24 + rng() * 32;
  const wallColor = new THREE.Color().setHSL(0.55 + rng() * 0.2, 0.35 + rng() * 0.25, 0.58 + rng() * 0.18);
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: wallColor,
    roughness: 0.65,
    metalness: 0.12,
  });
  const baseGeometry = new THREE.BoxGeometry(baseWidth, baseDepth, baseHeight);
  const baseMesh = new THREE.Mesh(baseGeometry, wallMaterial);
  baseMesh.position.set(0, 0, baseHeight / 2);
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  building.add(baseMesh);
  disposables.push(baseGeometry, wallMaterial);

  const roofHeight = 6 + rng() * 8;
  const roofMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.02 + rng() * 0.05, 0.15 + rng() * 0.1, 0.22 + rng() * 0.1),
    roughness: 0.55,
    metalness: 0.32,
  });
  const roofGeometry = new THREE.ConeGeometry(Math.max(baseWidth, baseDepth) * 0.65, roofHeight, 4);
  const roofMesh = new THREE.Mesh(roofGeometry, roofMaterial);
  roofMesh.rotation.y = Math.PI / 4;
  roofMesh.position.set(0, 0, baseHeight + roofHeight / 2);
  roofMesh.castShadow = true;
  roofMesh.receiveShadow = true;
  building.add(roofMesh);
  disposables.push(roofGeometry, roofMaterial);

  if (rng() > 0.45){
    const annexWidth = baseWidth * (0.45 + rng() * 0.25);
    const annexDepth = baseDepth * (0.4 + rng() * 0.25);
    const annexHeight = baseHeight * (0.35 + rng() * 0.3);
    const annexGeometry = new THREE.BoxGeometry(annexWidth, annexDepth, annexHeight);
    const annexMaterial = wallMaterial.clone();
    annexMaterial.color = wallColor.clone().offsetHSL((rng() - 0.5) * 0.08, (rng() - 0.5) * 0.05, (rng() - 0.5) * 0.1);
    const annexMesh = new THREE.Mesh(annexGeometry, annexMaterial);
    annexMesh.position.set((rng() - 0.5) * baseWidth * 0.6, (rng() - 0.5) * baseDepth * 0.6, annexHeight / 2);
    annexMesh.castShadow = true;
    annexMesh.receiveShadow = true;
    building.add(annexMesh);
    disposables.push(annexGeometry, annexMaterial);
  }

  if (rng() > 0.5){
    const hangarHeight = baseHeight * 0.4;
    const hangarWidth = baseWidth * (0.5 + rng() * 0.3);
    const hangarDepth = baseDepth * (0.8 + rng() * 0.1);
    const hangarGeometry = new THREE.BoxGeometry(hangarWidth, hangarDepth, hangarHeight);
    const hangarMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.6 + rng() * 0.05, 0.22, 0.48),
      roughness: 0.6,
      metalness: 0.25,
    });
    const hangarMesh = new THREE.Mesh(hangarGeometry, hangarMaterial);
    hangarMesh.position.set((rng() - 0.5) * baseWidth * 0.7, (rng() - 0.5) * baseDepth * 0.3, hangarHeight / 2);
    hangarMesh.castShadow = true;
    hangarMesh.receiveShadow = true;
    building.add(hangarMesh);
    disposables.push(hangarGeometry, hangarMaterial);
  }

  building.rotation.z = rng() * Math.PI * 2;

  return { object: building, disposables };
}

function chunkKey(x, y){
  return `${x}:${y}`;
}

function ensureWorldOriginOffset(){
  if (!worldOriginOffset){
    worldOriginOffset = new THREE.Vector3(0, 0, 0);
  }
  return worldOriginOffset;
}

function convertSimPositionToScene(simPosition){
  const originOffset = ensureWorldOriginOffset();
  const scaled = new THREE.Vector3(
    (Array.isArray(simPosition) ? simPosition[0] : 0) / SCENE_TO_SIM_SCALE.x,
    (Array.isArray(simPosition) ? simPosition[1] : 0) / SCENE_TO_SIM_SCALE.y,
    (Array.isArray(simPosition) ? simPosition[2] : 0) / SCENE_TO_SIM_SCALE.z,
  );
  return scaled.sub(originOffset);
}

function updateWorldStreaming(){
  if (!scene || !worldManager) return;
  const focus = getCurrentWorldFocusPosition();
  if (!focus) return;
  const adjustedFocus = maybeRebaseWorld(focus.clone());
  worldManager.update(adjustedFocus);
}

function getCurrentWorldFocusPosition(){
  const followId = getCurrentFollowId();
  if (followId){
    const mesh = planeMeshes.get(followId);
    if (mesh){
      return mesh.position.clone();
    }
  }
  if (camera){
    return camera.position.clone();
  }
  return new THREE.Vector3();
}

function maybeRebaseWorld(focusPosition){
  if (!focusPosition) return focusPosition;
  const horizontalDistanceSq = (focusPosition.x * focusPosition.x) + (focusPosition.y * focusPosition.y);
  if (horizontalDistanceSq < WORLD_REBASE_DISTANCE_SQ){
    return focusPosition;
  }
  const shift = new THREE.Vector3(focusPosition.x, focusPosition.y, 0);
  applyWorldOriginShift(shift);
  focusPosition.sub(shift);
  return focusPosition;
}

function applyWorldOriginShift(shift){
  if (!shift || (!shift.x && !shift.y && !shift.z)) return;
  const originOffset = ensureWorldOriginOffset();
  originOffset.add(shift);

  planeMeshes.forEach((mesh) => {
    if (mesh?.position){
      mesh.position.sub(shift);
    }
  });

  Object.values(cakes).forEach((mesh) => {
    if (mesh?.position){
      mesh.position.sub(shift);
    }
  });

  if (camera?.position){
    camera.position.sub(shift);
  }

  if (worldManager && typeof worldManager.handleOriginShift === 'function'){
    worldManager.handleOriginShift(shift);
  }
}

function createSeededRng(seedBase, x, y){
  const seed = xmur3(`${seedBase}:${x}:${y}`)();
  return mulberry32(seed);
}

function xmur3(str){
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1){
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function(){
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(a){
  return function(){
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Three.js init & loop ----
function initThree(){
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfd3ff);
  camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 10000);
  renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  worldOriginOffset = new THREE.Vector3(0, 0, 0);

  window.addEventListener('resize', onWindowResize);

  // Layered light rig: hemisphere for ambient mood and a sun-style directional light.
  const hemi = new THREE.HemisphereLight(0xe4f1ff, 0x3a5d2f, 0.8);
  hemi.position.set(0, 200, 0);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 0.85);
  dir.position.set(-180, 220, 260);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.camera.left = -400;
  dir.shadow.camera.right = 400;
  dir.shadow.camera.top = 400;
  dir.shadow.camera.bottom = -400;
  dir.shadow.camera.far = 1200;
  scene.add(dir);

  buildEnvironment(scene);

  setInterval(removeStalePlanes, 1000);

  requestAnimationFrame(animate);
}

function onWindowResize(){
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

function animate(now){
  requestAnimationFrame(animate);
  const delta = (lastFrameTime === null || now === undefined) ? 0 : (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  updateManualControl(delta);
  updateWorldStreaming();
  renderer.render(scene, camera);
}

function removeStalePlanes(){
  const now = performance.now();

  if (followManager){
    const statuses = followManager.getPlaneStatuses(now);
    const hadStale = statuses.some((status) => status.stale);
    const { removedIds, followChanged } = followManager.reapStalePlanes(now);

    removedIds.forEach((id) => {
      const mesh = planeMeshes.get(id);
      if (mesh) scene.remove(mesh);
      disposePlaneResources(id);
      planeMeshes.delete(id);
      manualOverrideStateByPlane.delete(id);
    });

    const { followId } = syncFollowState({ refreshCamera: followChanged });

    if (hadStale || removedIds.length > 0 || followChanged){
      refreshPlaneSelector();
    }

    if (!followId){
      setSimManualOverrideActive(false);
    }
    return;
  }

  for (const [id, last] of planeLastSeen.entries()){
    if ((now - last) > PLANE_STALE_TIMEOUT_MS){
      const mesh = planeMeshes.get(id);
      if (mesh) scene.remove(mesh);
      disposePlaneResources(id);
      planeMeshes.delete(id);
      planeLastSeen.delete(id);
      manualOverrideStateByPlane.delete(id);
      if (currentFollowId === id) currentFollowId = null;
    }
  }

  // if not following anyone, follow the first available
  if (!currentFollowId && planeMeshes.size > 0){
    const firstEntry = planeMeshes.entries().next().value;
    if (firstEntry){
      currentFollowId = firstEntry[0];
      updateCameraTarget(firstEntry[1]);
      refreshSimManualOverrideState();
    }
  }

  if (!currentFollowId){
    setSimManualOverrideActive(false);
  }

  refreshPlaneSelector();
}

function updateCameraTarget(mesh){
  camera.position.set(mesh.position.x - 40, mesh.position.y + 0, mesh.position.z + 20);
  camera.lookAt(mesh.position);
}

function updateManualOverrideIndicator(id, isActive){
  manualOverrideStateByPlane.set(id, Boolean(isActive));
  const followId = getCurrentFollowId();
  if (id === followId){
    setSimManualOverrideActive(Boolean(isActive));
  }
}

function setSimManualOverrideActive(active){
  const nextValue = Boolean(active);
  if (simManualOverrideActive === nextValue) return;
  simManualOverrideActive = nextValue;
  updateHudStatus();
}

function refreshSimManualOverrideState(){
  const followId = getCurrentFollowId();
  if (!followId){
    setSimManualOverrideActive(false);
    return;
  }
  const active = manualOverrideStateByPlane.get(followId) || false;
  setSimManualOverrideActive(Boolean(active));
}

// ---- Manual control (viewer-side only; sim is still source of truth when telemetry is applied) ----
function setManualControlEnabled(enabled){
  const shouldEnable = Boolean(enabled);
  if (manualControlEnabled === shouldEnable) return;
  manualControlEnabled = shouldEnable;

  if (!manualControlEnabled){
    pressedKeys.clear();
    setManualMovementActive(false);
    // Disable thrust quietly while avoiding recursive manual re-enabling.
    setAccelerationEngaged(false, { skipManualEnforce: true });
    lastKnownManualVelocity = [0, 0, 0];
    emitManualOverrideSnapshot({ force: true, enabledOverride: false });
  } else {
    emitManualOverrideSnapshot({ force: true, enabledOverride: true });
  }

  updateManualButtonState();
  updateHudStatus();
}

function setInvertAxesEnabled(enabled){
  const shouldEnable = Boolean(enabled);
  if (invertAxesEnabled === shouldEnable) return;
  invertAxesEnabled = shouldEnable;
  persistInvertAxesPreference(shouldEnable);
  updateInvertAxesButtonState();
  updateHudStatus();
  renderControlDocs(currentControlDocs);
}

function setAccelerationEngaged(enabled, options = {}){
  const shouldEnable = Boolean(enabled);
  if (accelerationEngaged === shouldEnable) return;

  if (shouldEnable && !manualControlEnabled && !options.skipManualEnforce){
    setManualControlEnabled(true);
    if (!manualControlEnabled) return;
  }

  accelerationEngaged = shouldEnable;
  if (!shouldEnable){
    forwardSpeed = 0;
  }

  updateAccelerationButtonState();
  updateHudStatus();
  if (!options.skipCruiseSync){
    syncCruiseControllerTarget();
  }
}

function handleKeyDown(event){
  const { code } = event;

  if (code === 'KeyM'){
    setManualControlEnabled(!manualControlEnabled);
    return;
  }

  if (code === 'KeyT'){
    setAccelerationEngaged(!accelerationEngaged);
    return;
  }

  if (code === 'BracketRight'){
    event.preventDefault();
    cycleFollowTarget(1);
    return;
  }

  if (code === 'BracketLeft'){
    event.preventDefault();
    cycleFollowTarget(-1);
    return;
  }

  if (!MOVEMENT_KEY_CODES.has(code)) return;

  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(code)){
    event.preventDefault();
  }

  pressedKeys.add(code);
  if (manualControlEnabled) setManualMovementActive(true);
}

function handleKeyUp(event){
  const { code } = event;
  if (!MOVEMENT_KEY_CODES.has(code)) return;

  pressedKeys.delete(code);
  if (manualControlEnabled && !isAnyMovementKeyActive()){
    setManualMovementActive(false);
  }
}

function isAnyMovementKeyActive(){
  for (const code of MOVEMENT_KEY_CODES){
    if (pressedKeys.has(code)) return true;
  }
  return false;
}

function setManualMovementActive(active){
  if (manualMovementActive === active) return;
  manualMovementActive = active;
  updateHudStatus();
}

function computeManualSceneVelocity(){
  const velocity = { x: 0, y: 0, z: 0 };

  if (pressedKeys.has('KeyW')) velocity.y += TRANSLATION_SPEED;
  if (pressedKeys.has('KeyS')) velocity.y -= TRANSLATION_SPEED;
  if (pressedKeys.has('KeyA')) velocity.x -= TRANSLATION_SPEED;
  if (pressedKeys.has('KeyD')) velocity.x += TRANSLATION_SPEED;

  if (pressedKeys.has('KeyR') || pressedKeys.has('Space')) velocity.z += ALTITUDE_SPEED;
  if (pressedKeys.has('KeyF') || pressedKeys.has('ShiftLeft') || pressedKeys.has('ShiftRight')) velocity.z -= ALTITUDE_SPEED;

  return velocity;
}

function updateManualControl(delta){
  if (!manualControlEnabled) return;
  const followId = getCurrentFollowId();
  const mesh = planeMeshes.get(followId);
  const d = Number.isFinite(delta) ? Math.max(delta, 0) : 0;
  const movementActive = isAnyMovementKeyActive() || (accelerationEngaged && forwardSpeed > 0.1);
  setManualMovementActive(movementActive);

  const velocityScene = computeManualSceneVelocity();

  if (accelerationEngaged){
    forwardSpeed = clamp(forwardSpeed + ACCELERATION_RATE * d, 0, MAX_FORWARD_SPEED);
  } else {
    forwardSpeed = Math.max(0, forwardSpeed - NATURAL_DECEL * d);
  }

  if (forwardSpeed > 0){
    velocityScene.y += forwardSpeed;
  }

  let moved = false;
  if (mesh){
    const pos = mesh.position;
    if (velocityScene.x !== 0){ pos.x += velocityScene.x * d; moved = true; }
    if (velocityScene.y !== 0){ pos.y += velocityScene.y * d; moved = true; }
    if (velocityScene.z !== 0){ pos.z += velocityScene.z * d; moved = true; }

    pos.z = clamp(pos.z, MIN_ALTITUDE, MAX_ALTITUDE);
  }

  let rotated = false;
  if (mesh){
    const rot = mesh.rotation;
    const rotationDelta = ROTATION_SPEED * d;
    const pitchFactor = invertAxesEnabled ? -1 : 1;
    const rollFactor = invertAxesEnabled ? -1 : 1;
    if (pressedKeys.has('KeyQ')){ rot.z += rotationDelta; rotated = true; }
    if (pressedKeys.has('KeyE')){ rot.z -= rotationDelta; rotated = true; }
    if (pressedKeys.has('ArrowUp')){ rot.y += rotationDelta * pitchFactor; rotated = true; }
    if (pressedKeys.has('ArrowDown')){ rot.y -= rotationDelta * pitchFactor; rotated = true; }
    if (pressedKeys.has('ArrowLeft')){ rot.x += rotationDelta * rollFactor; rotated = true; }
    if (pressedKeys.has('ArrowRight')){ rot.x -= rotationDelta * rollFactor; rotated = true; }

    rot.x = clamp(rot.x, -MAX_ROLL, MAX_ROLL);
    rot.y = clamp(rot.y, -MAX_PITCH, MAX_PITCH);
  }

  if (mesh && (moved || rotated)) updateCameraTarget(mesh);

  if (accelerationEngaged || forwardSpeed > 0.1){
    updateHudStatus();
  }

  const orientation = mesh
    ? [mesh.rotation.z, mesh.rotation.y, mesh.rotation.x]
    : lastKnownManualOrientation;
  if (mesh){
    lastKnownManualOrientation = orientation;
  }

  const velocitySim = sceneVelocityToSim(velocityScene);
  lastKnownManualVelocity = velocitySim;

  maybeSendManualOverride({
    enabled: manualControlEnabled,
    velocity: velocitySim,
    orientation,
  });
}

function sceneVelocityToSim(velocity){
  if (!velocity) return [0, 0, 0];
  return [
    velocity.x * SCENE_TO_SIM_SCALE.x,
    velocity.y * SCENE_TO_SIM_SCALE.y,
    velocity.z * SCENE_TO_SIM_SCALE.z,
  ];
}

function emitManualOverrideSnapshot(options = {}){
  const followId = getCurrentFollowId();
  const mesh = planeMeshes.get(followId);
  let orientation = lastKnownManualOrientation;
  if (mesh){
    orientation = [mesh.rotation.z, mesh.rotation.y, mesh.rotation.x];
    lastKnownManualOrientation = orientation;
  }

  const enabledOverride = options.enabledOverride;
  const enabled = typeof enabledOverride === 'boolean' ? enabledOverride : Boolean(manualControlEnabled);
  const velocity = enabled ? lastKnownManualVelocity : [0, 0, 0];

  maybeSendManualOverride({
    enabled,
    velocity,
    orientation,
    force: Boolean(options.force),
    targetId: followId || undefined,
  });
}

function maybeSendManualOverride(update){
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const targetId = update.targetId || getCurrentFollowId() || 'plane-1';
  if (!targetId) return;

  const normalized = {
    targetId,
    enabled: Boolean(update.enabled),
  };

  if (Array.isArray(update.velocity) && update.velocity.length === 3){
    normalized.velocity = update.velocity.map((component) => Number(component) || 0);
  }

  if (Array.isArray(update.orientation) && update.orientation.length === 3){
    normalized.orientation = update.orientation.map((component) => Number(component) || 0);
  }

  if (!update.force && manualOverridePayloadEqual(lastManualOverridePayload, normalized)){
    return;
  }

  const params = { enabled: normalized.enabled };
  if (normalized.velocity) params.velocity = normalized.velocity;
  if (normalized.orientation) params.orientation = normalized.orientation;

  sendSimCommand('manual_override', params, {
    includeCommandId: false,
    targetId,
  });
  lastManualOverridePayload = normalized;
}

function manualOverridePayloadEqual(previous, next){
  if (!previous || !next) return false;
  if (previous.enabled !== next.enabled) return false;
  if (previous.targetId !== next.targetId) return false;
  if (!compareVector(previous.velocity, next.velocity, MANUAL_VELOCITY_EPSILON)) return false;
  if (!compareVector(previous.orientation, next.orientation, MANUAL_ORIENTATION_EPSILON)) return false;
  return true;
}

function compareVector(a, b, epsilon){
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1){
    if (Math.abs(a[i] - b[i]) > epsilon) return false;
  }
  return true;
}

function clamp(value, min, max){
  return Math.min(Math.max(value, min), max);
}

function updateHudStatus(){
  if (!HUD) return;
  const controlMode = manualControlEnabled
    ? `Manual ${manualMovementActive ? '(active)' : '(idle)'}`
    : 'Telemetry';
  const accelLabel = accelerationEngaged
    ? `Forward acceleration: ON (${forwardSpeed.toFixed(0)} u/s)`
    : 'Forward acceleration: off';
  const simOverrideLabel = simManualOverrideActive
    ? 'Simulator override: MANUAL'
    : 'Simulator override: autopilot';
  const invertStatusLabel = invertAxesEnabled
    ? 'Pitch/Roll controls: inverted'
    : 'Pitch/Roll controls: standard';
  const modelStatus = computeModelSetStatus();
  const modelLine = modelStatus.note
    ? `${modelStatus.label} ${modelStatus.note}`.trim()
    : modelStatus.label;
  const arrowInstructions = invertAxesEnabled
    ? 'arrows pitch/roll (inverted)'
    : 'arrows pitch/roll';

  HUD.innerText =
    `${connectionStatus}\n` +
    `Mode: ${controlMode}\n` +
    `Model set: ${modelLine}\n` +
    `${accelLabel}\n` +
    `${simOverrideLabel}\n` +
    `${invertStatusLabel}\n` +
    `[M] toggle manual · [T] toggle thrust · WASD/RF move · QE yaw · ${arrowInstructions}`;

  if (MODEL_SET_STATUS){
    MODEL_SET_STATUS.textContent = `Active aircraft: ${modelLine}`.trim();
  }
  syncModelSetPicker();
  updateConnectionBanner(); // keep the banner in sync with connectionStatus
}

function computeModelSetStatus(){
  const activeSet = MODEL_SETS[currentModelSetKey] || MODEL_SETS[DEFAULT_MODEL_SET_KEY];
  if (!activeSet){
    return { label: 'Unavailable', note: '(not configured)' };
  }
  if (aircraftLoadError){
    return { label: activeSet.label, note: '(fallback active)' };
  }
  const cacheEntry = modelSetAssetCache.get(currentModelSetKey);
  if (cacheEntry?.promise){
    return { label: activeSet.label, note: '(loading…)' };
  }
  if (cacheEntry?.template || aircraftTemplate){
    return { label: activeSet.label, note: '(ready)' };
  }
  return { label: activeSet.label, note: '(initializing…)' };
}

function syncModelSetPicker(){
  if (!MODEL_SET_SELECT || !MODEL_SET_SELECT.options?.length) return;
  if (MODEL_SET_SELECT.value !== currentModelSetKey){
    MODEL_SET_SELECT.value = currentModelSetKey;
  }
}

// Minimal banner updater driven by the plain `connectionStatus` string.
function updateConnectionBanner(){
  if (!CONNECTION_BANNER) return;

  // Show the banner when we’re not cleanly connected.
  const shouldShow = /Reconnecting|Connection lost|Connection error|Connecting…/i.test(connectionStatus);
  if (shouldShow){
    CONNECTION_BANNER.removeAttribute('hidden');
  } else {
    CONNECTION_BANNER.setAttribute('hidden', '');
  }

  if (CONNECTION_BANNER_MESSAGE){
    CONNECTION_BANNER_MESSAGE.textContent = connectionStatus;
  }

  if (CONNECTION_RECONNECT_BUTTON){
    // Disable during the automatic countdown phase (user sees remaining seconds)
    const disabled = /Reconnecting in \d+s/.test(connectionStatus);
    CONNECTION_RECONNECT_BUTTON.textContent = UI_STRINGS?.buttons?.reconnect || 'Reconnect';
    CONNECTION_RECONNECT_BUTTON.disabled = disabled;
  }

  // Optional: reflect status as a data-attribute for CSS hooks
  // (maps to coarse states based on text)
  const statusKey =
    /Connected/.test(connectionStatus) ? 'connected' :
    /Reconnecting/.test(connectionStatus) ? 'reconnecting' :
    /Connecting/.test(connectionStatus) ? 'connecting' :
    /error/i.test(connectionStatus) ? 'error' :
    /lost/i.test(connectionStatus) ? 'disconnected' :
    'unknown';
  CONNECTION_BANNER.dataset.status = statusKey;
}


function wireButtonHandlers(){
  // Bind UI buttons to the same logic used by the keyboard shortcuts so the
  // behaviour is always synchronized no matter how the pilot interacts.
  if (MANUAL_BUTTON){
    MANUAL_BUTTON.addEventListener('click', () => {
      setManualControlEnabled(!manualControlEnabled);
    });
  }

  if (INVERT_AXES_BUTTON){
    INVERT_AXES_BUTTON.addEventListener('click', () => {
      setInvertAxesEnabled(!invertAxesEnabled);
    });
  }

  if (ACCELERATE_BUTTON){
    ACCELERATE_BUTTON.addEventListener('click', () => {
      setAccelerationEngaged(!accelerationEngaged);
    });
  }

  if (REROUTE_BUTTON){
    REROUTE_BUTTON.addEventListener('click', () => {
      cycleAutopilotWaypoints();
    });
  }

  updateManualButtonState();
  updateInvertAxesButtonState();
  updateAccelerationButtonState();
  updateRerouteButtonState();
}

function setupModelSetPicker(){
  if (!MODEL_SET_SELECT) return;
  MODEL_SET_SELECT.innerHTML = '';
  Object.entries(MODEL_SETS).forEach(([key, set]) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = set.label;
    MODEL_SET_SELECT.appendChild(option);
  });
  MODEL_SET_SELECT.addEventListener('change', (event) => {
    const desiredKey = event.target.value;
    handleModelSetSelection(desiredKey);
  });
  syncModelSetPicker();
}

function setupPlaneSelector(){
  if (!PLANE_FOLLOW_SELECT) return;
  PLANE_FOLLOW_SELECT.addEventListener('change', handlePlaneSelectionChange);
  refreshPlaneSelector();
}

function refreshPlaneSelector(){
  if (!PLANE_FOLLOW_SELECT) return;
  const statuses = followManager ? followManager.getPlaneStatuses() : [];
  const followId = getCurrentFollowId();

  PLANE_FOLLOW_SELECT.innerHTML = '';

  if (!statuses.length){
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Waiting for planes…';
    option.disabled = true;
    option.selected = true;
    PLANE_FOLLOW_SELECT.appendChild(option);
    PLANE_FOLLOW_SELECT.disabled = true;
    if (PLANE_SELECTOR_STATUS){
      PLANE_SELECTOR_STATUS.textContent = 'Waiting for telemetry…';
    }
    return;
  }

  PLANE_FOLLOW_SELECT.disabled = false;

  statuses.forEach(({ id, stale }) => {
    const option = document.createElement('option');
    option.value = id;
    option.dataset.state = stale ? 'stale' : 'active';
    option.textContent = `${stale ? '⚠️' : '🟢'} ${id}${stale ? ' (stale)' : ''}`;
    PLANE_FOLLOW_SELECT.appendChild(option);
  });

  let selectedId = followId;
  const hasFollow = selectedId && statuses.some((s) => s.id === selectedId);
  if (!hasFollow){
    selectedId = statuses[0]?.id || '';
    if (selectedId && followManager){
      followManager.setFollow(selectedId);
      syncFollowState();
    } else {
      currentFollowId = selectedId || null;
    }
  }

  if (selectedId){
    PLANE_FOLLOW_SELECT.value = selectedId;
  } else {
    PLANE_FOLLOW_SELECT.selectedIndex = 0;
  }

  if (PLANE_SELECTOR_STATUS){
    if (!selectedId){
      PLANE_SELECTOR_STATUS.textContent = 'Select an aircraft to focus the camera. Use ] and [ to cycle.';
    } else {
      const selectedStatus = statuses.find((s) => s.id === selectedId);
      if (selectedStatus?.stale){
        PLANE_SELECTOR_STATUS.textContent = `${selectedId} is awaiting telemetry.`;
      } else {
        PLANE_SELECTOR_STATUS.textContent = `Following ${selectedId}. Use ] and [ to cycle.`;
      }
    }
  }
}

function handlePlaneSelectionChange(event){
  if (!followManager) return;
  const selectedId = event.target.value;
  followManager.setFollow(selectedId || null);
  syncFollowState({ refreshCamera: true });
  refreshPlaneSelector();
}

function cycleFollowTarget(step){
  if (!followManager) return;
  followManager.cycleFollow(step);
  syncFollowState({ refreshCamera: true });
  refreshPlaneSelector();
}

function syncFollowState(options = {}){
  const previous = currentFollowId;
  const nextId = followManager ? followManager.getFollow() : currentFollowId;
  currentFollowId = nextId || null;
  if (previous !== currentFollowId){
    refreshSimManualOverrideState();
  }
  if (options.refreshCamera){
    updateCameraTargetForCurrentPlane();
  }
  return { changed: previous !== currentFollowId, followId: currentFollowId };
}

function getCurrentFollowId(){
  if (followManager){
    const nextId = followManager.getFollow();
    if (nextId !== currentFollowId){
      currentFollowId = nextId || null;
    }
  }
  return currentFollowId;
}

function updateCameraTargetForCurrentPlane(){
  const followId = getCurrentFollowId();
  if (!followId) return;
  const mesh = planeMeshes.get(followId);
  if (mesh) updateCameraTarget(mesh);
}

function handleModelSetSelection(desiredKey){
  const resolvedKey = resolveModelSetKey(desiredKey);
  const nextKey = MODEL_SETS[resolvedKey] ? resolvedKey : DEFAULT_MODEL_SET_KEY;
  currentModelSetKey = nextKey;
  currentModelSet = MODEL_SETS[currentModelSetKey] || MODEL_SETS[DEFAULT_MODEL_SET_KEY];
  runtimeModelSetKey = currentModelSetKey;
  persistModelSetKey(currentModelSetKey);

  aircraftTemplate = null;
  aircraftLoadPromise = null;
  aircraftLoadError = false;

  syncModelSetPicker();
  updateHudStatus();

  beginAircraftLoad();
}

function loadControlDocs(){
  if (!CONTROL_INSTRUCTIONS_LIST) return;

  // Attempt to fetch descriptive metadata from the Go broker; fall back to
  // the static defaults if the endpoint is unavailable (e.g. when served
  // from a static file system or older broker build).
  fetch('/api/controls', { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`Unexpected status ${response.status}`);
      return response.json();
    })
    .then((docs) => renderControlDocs(Array.isArray(docs) ? docs : DEFAULT_CONTROL_DOCS))
    .catch(() => renderControlDocs(DEFAULT_CONTROL_DOCS));
}

function renderControlDocs(docs){
  if (!CONTROL_INSTRUCTIONS_LIST) return;
  const docsToRender = Array.isArray(docs) && docs.length ? docs : DEFAULT_CONTROL_DOCS;
  currentControlDocs = docsToRender;
  CONTROL_INSTRUCTIONS_LIST.innerHTML = '';
  const inversionNote = invertAxesEnabled ? 'Pitch/Roll inverted' : 'Pitch/Roll standard';
  docsToRender.forEach((doc) => {
    const li = document.createElement('li');
    const label = doc?.label || 'Control';
    const description = doc?.description || '';
    const baseText = `${label}: ${description}`.trim();
    const shouldAnnotate = (doc && doc.id === 'keyboard') || /flight keys/i.test(label);
    li.textContent = shouldAnnotate && baseText
      ? `${baseText} [${inversionNote}]`
      : (baseText || label || '');
    CONTROL_INSTRUCTIONS_LIST.appendChild(li);
  });
}

function updateManualButtonState(){
  if (!MANUAL_BUTTON) return;
  MANUAL_BUTTON.textContent = manualControlEnabled ? 'Disable Manual Control' : 'Enable Manual Control';
  MANUAL_BUTTON.classList.toggle('is-active', manualControlEnabled);
}

function updateInvertAxesButtonState(){
  if (!INVERT_AXES_BUTTON) return;
  const label = invertAxesEnabled ? 'Invert Pitch/Roll: On' : 'Invert Pitch/Roll: Off';
  INVERT_AXES_BUTTON.textContent = label;
  INVERT_AXES_BUTTON.classList.toggle('is-active', invertAxesEnabled);
}

function updateAccelerationButtonState(){
  if (!ACCELERATE_BUTTON) return;
  const label = accelerationEngaged ? 'Stop Forward Acceleration' : 'Start Forward Acceleration';
  ACCELERATE_BUTTON.textContent = label;
  ACCELERATE_BUTTON.classList.toggle('is-active', accelerationEngaged);
}

function resolveModelSetKey(preferredKey){
  if (preferredKey && MODEL_SETS[preferredKey]) {
    runtimeModelSetKey = preferredKey;
    return preferredKey;
  }

  if (preferredKey && !MODEL_SETS[preferredKey]) {
    runtimeModelSetKey = DEFAULT_MODEL_SET_KEY;
    return DEFAULT_MODEL_SET_KEY;
  }

  if (runtimeModelSetKey && MODEL_SETS[runtimeModelSetKey]) {
    return runtimeModelSetKey;
  }

  let queryKey = null;
  try {
    const params = new URLSearchParams(window.location.search);
    queryKey = params.get('modelSet') || params.get('modelset');
  } catch (err) {
    console.warn('Unable to parse modelSet parameter', err);
  }
  if (queryKey && MODEL_SETS[queryKey]){
    runtimeModelSetKey = queryKey;
    return queryKey;
  }

  const storedKey = readPersistedModelSetKey();
  if (storedKey && MODEL_SETS[storedKey]){
    runtimeModelSetKey = storedKey;
    return storedKey;
  }

  runtimeModelSetKey = DEFAULT_MODEL_SET_KEY;
  return DEFAULT_MODEL_SET_KEY;
}

function readPersistedModelSetKey(){
  if (modelSetStorageUnavailable) return null;
  try {
    if (typeof window === 'undefined' || !window.localStorage){
      modelSetStorageUnavailable = true;
      return null;
    }
    return window.localStorage.getItem(MODEL_SET_STORAGE_KEY);
  } catch (err) {
    if (!modelSetStorageUnavailable) {
      console.warn('Unable to read model set from storage', err);
    }
    modelSetStorageUnavailable = true;
  }
  return null;
}

function persistModelSetKey(key){
  if (modelSetStorageUnavailable) return;
  try {
    if (typeof window === 'undefined' || !window.localStorage){
      modelSetStorageUnavailable = true;
      return;
    }
    window.localStorage.setItem(MODEL_SET_STORAGE_KEY, key);
  } catch (err) {
    if (!modelSetStorageUnavailable) {
      console.warn('Unable to persist model set selection', err);
    }
    modelSetStorageUnavailable = true;
  }
}

function readPersistedInvertAxesPreference(){
  if (invertAxesStorageUnavailable) return false;
  try {
    if (typeof window === 'undefined' || !window.localStorage){
      invertAxesStorageUnavailable = true;
      return false;
    }
    const stored = window.localStorage.getItem(INVERT_AXES_STORAGE_KEY);
    return stored === 'true';
  } catch (err) {
    if (!invertAxesStorageUnavailable) {
      console.warn('Unable to read invert axes preference', err);
    }
    invertAxesStorageUnavailable = true;
  }
  return false;
}

function persistInvertAxesPreference(enabled){
  if (invertAxesStorageUnavailable) return;
  try {
    if (typeof window === 'undefined' || !window.localStorage){
      invertAxesStorageUnavailable = true;
      return;
    }
    window.localStorage.setItem(INVERT_AXES_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch (err) {
    if (!invertAxesStorageUnavailable) {
      console.warn('Unable to persist invert axes preference', err);
    }
    invertAxesStorageUnavailable = true;
  }
}

function setupMapPicker(){
  if (MAP_SELECT){
    MAP_SELECT.addEventListener('change', (event) => {
      const nextId = event.target?.value;
      if (!nextId) return;
      runtimeMapId = nextId;
      persistMapId(nextId);
      rebuildWorldForCurrentMap({ mapId: nextId, reason: 'user-selection' });
    });
  }

  const activeEntry = availableMaps.get(currentMapId) || availableMaps.get(DEFAULT_MAP_ID);
  if (activeEntry){
    updateMapStatus({ label: activeEntry.label, note: '(loading…)' });
  } else {
    updateMapStatus({ label: 'Loading maps…' });
  }

  loadMapManifest()
    .catch((err) => {
      console.warn('Unable to load map manifest', err);
    })
    .finally(() => {
      const resolvedId = resolveMapId(currentMapId);
      currentMapId = resolvedId;
      refreshMapSelectOptions(resolvedId);
      if (MAP_SELECT){
        MAP_SELECT.value = resolvedId;
      }
      rebuildWorldForCurrentMap({ mapId: resolvedId, force: true });
    });
}

function loadMapManifest(){
  if (typeof fetch !== 'function'){
    return Promise.resolve();
  }

  return fetch('assets/maps/manifest.json', { cache: 'no-cache' })
    .then((resp) => {
      if (!resp.ok){
        throw new Error(`HTTP ${resp.status}`);
      }
      return resp.json();
    })
    .then((manifest) => {
      if (!manifest) return;
      if (Array.isArray(manifest.maps)){
        manifest.maps.forEach((entry) => registerMapEntry(entry));
      }
      if (manifest.default && availableMaps.has(manifest.default)){
        currentMapId = manifest.default;
      }
    });
}

function registerMapEntry(entry){
  if (!entry || !entry.id) return;
  const normalized = {
    id: entry.id,
    label: entry.label || entry.name || entry.id,
    type: entry.type || 'procedural',
    path: entry.path || entry.manifest || null,
    seed: entry.seed,
    chunkSize: entry.chunkSize,
    visibleRadius: entry.visibleRadius,
    tileSize: entry.tileSize,
    fallback: entry.fallback,
  };
  availableMaps.set(normalized.id, normalized);
}

function refreshMapSelectOptions(selectedId){
  if (!MAP_SELECT) return;
  const ordered = Array.from(availableMaps.values()).sort((a, b) => {
    if (a.id === DEFAULT_MAP_ID && b.id !== DEFAULT_MAP_ID) return -1;
    if (b.id === DEFAULT_MAP_ID && a.id !== DEFAULT_MAP_ID) return 1;
    return (a.label || a.id).localeCompare(b.label || b.id);
  });

  MAP_SELECT.innerHTML = '';
  ordered.forEach((entry) => {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.label || entry.id;
    MAP_SELECT.appendChild(option);
  });

  if (selectedId && availableMaps.has(selectedId)){
    MAP_SELECT.value = selectedId;
  }
}

function updateMapStatus(status){
  if (!MAP_STATUS) return;
  if (!status){
    MAP_STATUS.textContent = '';
    return;
  }
  const label = status.label || '';
  const note = status.note ? ` ${status.note}` : '';
  MAP_STATUS.textContent = `${label}${note}`.trim();
}

function resolveMapId(preferredId){
  if (preferredId && availableMaps.has(preferredId)){
    runtimeMapId = preferredId;
    return preferredId;
  }

  if (preferredId && !availableMaps.has(preferredId)){
    runtimeMapId = DEFAULT_MAP_ID;
    return DEFAULT_MAP_ID;
  }

  if (runtimeMapId && availableMaps.has(runtimeMapId)){
    return runtimeMapId;
  }

  let queryId = null;
  try {
    const params = new URLSearchParams(window.location.search);
    queryId = params.get('map') || params.get('mapId') || params.get('mapid');
  } catch (err) {
    console.warn('Unable to parse map parameter', err);
  }

  if (queryId && availableMaps.has(queryId)){
    runtimeMapId = queryId;
    return queryId;
  }

  const stored = readPersistedMapId();
  if (stored && availableMaps.has(stored)){
    runtimeMapId = stored;
    return stored;
  }

  runtimeMapId = DEFAULT_MAP_ID;
  return DEFAULT_MAP_ID;
}

function readPersistedMapId(){
  if (mapStorageUnavailable) return null;
  try {
    if (typeof window === 'undefined' || !window.localStorage){
      mapStorageUnavailable = true;
      return null;
    }
    return window.localStorage.getItem(MAP_STORAGE_KEY);
  } catch (err) {
    if (!mapStorageUnavailable){
      console.warn('Unable to read map selection from storage', err);
    }
    mapStorageUnavailable = true;
  }
  return null;
}

function persistMapId(mapId){
  if (mapStorageUnavailable) return;
  try {
    if (typeof window === 'undefined' || !window.localStorage){
      mapStorageUnavailable = true;
      return;
    }
    window.localStorage.setItem(MAP_STORAGE_KEY, mapId);
  } catch (err) {
    if (!mapStorageUnavailable){
      console.warn('Unable to persist map selection', err);
    }
    mapStorageUnavailable = true;
  }
}

async function rebuildWorldForCurrentMap(options = {}){
  if (!scene) return;
  const preferredId = options.mapId || currentMapId;
  const mapId = resolveMapId(preferredId);
  currentMapId = mapId;
  const entry = availableMaps.get(mapId) || availableMaps.get(DEFAULT_MAP_ID);
  if (entry){
    updateMapStatus({ label: entry.label, note: '(loading…)' });
  }

  const token = ++mapBuildToken;

  try {
    const descriptor = await ensureMapDescriptor(mapId);
    if (token !== mapBuildToken) return;

    const manager = createWorldManagerFromDescriptor(descriptor);
    if (token !== mapBuildToken){
      if (manager && typeof manager.dispose === 'function'){
        manager.dispose();
      }
      return;
    }

    replaceWorldManager(manager);
    const label = descriptor.label || entry?.label || mapId;
    updateMapStatus({ label, note: '(ready)' });
  } catch (err) {
    console.warn('Failed to build map', err);
    if (token !== mapBuildToken) return;

    if (mapId !== DEFAULT_MAP_ID){
      if (MAP_SELECT && MAP_SELECT.value !== DEFAULT_MAP_ID){
        MAP_SELECT.value = DEFAULT_MAP_ID;
      }
      rebuildWorldForCurrentMap({ mapId: DEFAULT_MAP_ID, force: true });
      return;
    }

    updateMapStatus({ label: entry?.label || 'World', note: '(unavailable)' });
  }
}

function replaceWorldManager(manager){
  if (worldManager && typeof worldManager.dispose === 'function'){
    worldManager.dispose();
  }
  worldManager = manager || null;
  if (worldManager){
    worldManager.update(new THREE.Vector3());
  }
}

async function ensureMapDescriptor(mapId){
  if (mapDescriptorCache.has(mapId)){
    return mapDescriptorCache.get(mapId);
  }

  const entry = availableMaps.get(mapId) || availableMaps.get(DEFAULT_MAP_ID);
  if (!entry){
    throw new Error(`Unknown map id: ${mapId}`);
  }

  if (entry.type === 'tilemap' && entry.path && typeof fetch === 'function'){
    const url = `assets/maps/${entry.path}`.replace(/\\/g, '/');
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok){
      throw new Error(`Failed to load map descriptor ${mapId}: HTTP ${response.status}`);
    }
    const descriptor = await response.json();
    const normalized = normalizeMapDescriptor(descriptor, entry);
    mapDescriptorCache.set(mapId, normalized);
    return normalized;
  }

  const normalized = normalizeMapDescriptor(entry, entry);
  mapDescriptorCache.set(mapId, normalized);
  return normalized;
}

function normalizeMapDescriptor(descriptor, entry){
  if (!descriptor) return null;
  const base = { ...descriptor };
  base.id = entry?.id || descriptor.id || DEFAULT_MAP_ID;
  base.label = base.label || entry?.label || base.name || base.id;
  base.type = base.type || entry?.type || 'procedural';

  if (base.type === 'tilemap'){
    base.tileSize = Number(base.tileSize || entry?.tileSize || WORLD_CHUNK_SIZE) || WORLD_CHUNK_SIZE;
    const radius = Number(base.visibleRadius ?? entry?.visibleRadius ?? WORLD_CHUNK_RADIUS);
    base.visibleRadius = Number.isFinite(radius) ? radius : WORLD_CHUNK_RADIUS;
    base.fallback = base.fallback || entry?.fallback || { type: 'procedural', seed: WORLD_SEED };
    base.tiles = Array.isArray(base.tiles) ? base.tiles : [];
  } else {
    base.type = 'procedural';
    base.seed = base.seed || entry?.seed || WORLD_SEED;
    base.chunkSize = Number(base.chunkSize || entry?.chunkSize || WORLD_CHUNK_SIZE) || WORLD_CHUNK_SIZE;
    const radius = Number(base.visibleRadius ?? entry?.visibleRadius ?? WORLD_CHUNK_RADIUS);
    base.visibleRadius = Number.isFinite(radius) ? radius : WORLD_CHUNK_RADIUS;
  }

  return base;
}

function createWorldManagerFromDescriptor(descriptor){
  if (!descriptor || !scene) return null;
  if (descriptor.type === 'tilemap'){
    return createTileMapWorld({ scene, descriptor });
  }
  const chunkSize = Number(descriptor.chunkSize) || WORLD_CHUNK_SIZE;
  const visibleRadius = Number(descriptor.visibleRadius) || WORLD_CHUNK_RADIUS;
  return createEndlessWorld({
    scene,
    chunkSize,
    visibleRadius,
    seed: descriptor.seed || WORLD_SEED,
  });
}

function createTileMapWorld({ scene: targetScene, descriptor }){
  if (!targetScene || !descriptor) return null;
  const chunkSize = Number(descriptor.tileSize) || WORLD_CHUNK_SIZE;
  const visibleRadius = Number(descriptor.visibleRadius) || WORLD_CHUNK_RADIUS;
  const tiles = new Map();
  const tileEntries = Array.isArray(descriptor.tiles) ? descriptor.tiles : [];
  tileEntries.forEach((tile) => {
    if (!tile) return;
    const coords = Array.isArray(tile.coords) ? tile.coords : tile.coordinates;
    if (!coords || coords.length < 2) return;
    const key = chunkKey(coords[0], coords[1]);
    tiles.set(key, { ...tile, coords: { x: coords[0], y: coords[1] } });
  });

  const worldRoot = new THREE.Group();
  worldRoot.name = `TileMapWorld_${descriptor.id || 'custom'}`;
  targetScene.add(worldRoot);

  const chunkMap = new Map();
  const fallbackSeed = descriptor.fallback?.seed || WORLD_SEED;
  const fallbackType = descriptor.fallback?.type || 'procedural';

  function update(focusPosition){
    if (!focusPosition) return;
    const originOffset = ensureWorldOriginOffset();
    const focusGlobal = focusPosition.clone().add(originOffset);
    const centerChunkX = Math.floor(focusGlobal.x / chunkSize);
    const centerChunkY = Math.floor(focusGlobal.y / chunkSize);
    const needed = new Set();

    for (let dx = -visibleRadius; dx <= visibleRadius; dx += 1){
      for (let dy = -visibleRadius; dy <= visibleRadius; dy += 1){
        const chunkX = centerChunkX + dx;
        const chunkY = centerChunkY + dy;
        const key = chunkKey(chunkX, chunkY);
        needed.add(key);
        if (!chunkMap.has(key)){
          const chunkEntry = spawnChunk(chunkX, chunkY);
          chunkMap.set(key, chunkEntry);
          worldRoot.add(chunkEntry.group);
        }
        const chunkEntry = chunkMap.get(key);
        positionChunk(chunkEntry);
      }
    }

    chunkMap.forEach((chunkEntry, key) => {
      if (!needed.has(key)){
        disposeChunk(chunkEntry);
        chunkMap.delete(key);
      }
    });
  }

  function spawnChunk(x, y){
    const key = chunkKey(x, y);
    const coords = { x, y };
    const tile = tiles.get(key);
    if (tile){
      const { group, disposables } = buildTileChunk({ descriptor, tile, chunkSize });
      group.name = `Tile_${x}_${y}`;
      positionChunk({ coords, group });
      return { coords, group, disposables };
    }

    if (fallbackType === 'procedural'){
      const rng = createSeededRng(fallbackSeed, x, y);
      const { group, disposables } = buildChunkContents({ coords, chunkSize, rng });
      group.name = `TileFallback_${x}_${y}`;
      positionChunk({ coords, group });
      return { coords, group, disposables };
    }

    const group = new THREE.Group();
    group.name = `TileEmpty_${x}_${y}`;
    positionChunk({ coords, group });
    return { coords, group, disposables: [] };
  }

  function positionChunk(chunkEntry){
    if (!chunkEntry || !chunkEntry.group) return;
    const originOffset = ensureWorldOriginOffset();
    const worldX = chunkEntry.coords.x * chunkSize;
    const worldY = chunkEntry.coords.y * chunkSize;
    chunkEntry.group.position.set(worldX - originOffset.x, worldY - originOffset.y, -originOffset.z);
  }

  function handleOriginShift(shift){
    if (!shift) return;
    chunkMap.forEach((chunkEntry) => {
      if (chunkEntry?.group?.position){
        chunkEntry.group.position.sub(shift);
      }
    });
  }

  function disposeChunk(chunkEntry){
    if (!chunkEntry) return;
    if (chunkEntry.group){
      worldRoot.remove(chunkEntry.group);
      if (typeof chunkEntry.group.clear === 'function'){
        chunkEntry.group.clear();
      }
    }
    if (Array.isArray(chunkEntry.disposables)){
      chunkEntry.disposables.forEach((resource) => {
        if (resource && typeof resource.dispose === 'function'){
          resource.dispose();
        }
      });
    }
  }

  function disposeAll(){
    chunkMap.forEach((chunkEntry) => disposeChunk(chunkEntry));
    chunkMap.clear();
    targetScene.remove(worldRoot);
  }

  return { update, handleOriginShift, dispose: disposeAll };
}

function buildTileChunk({ descriptor, tile, chunkSize }){
  const group = new THREE.Group();
  const disposables = [];

  const baseColor = resolveColor(tile.groundColor || descriptor.groundColor, '#6a8b5d');
  const elevation = Number(tile.baseHeight || tile.elevation || 0) || 0;

  if (tile.heightfield){
    const heightMesh = createHeightfieldMesh({
      descriptor: tile.heightfield,
      chunkSize,
      elevation,
      color: baseColor,
    });
    if (heightMesh){
      group.add(heightMesh.mesh);
      disposables.push(heightMesh.geometry, heightMesh.material);
    }
  } else {
    const ground = createGroundPlane({ chunkSize, color: baseColor, elevation });
    group.add(ground.mesh);
    disposables.push(ground.geometry, ground.material);
  }

  if (Array.isArray(tile.objects)){
    tile.objects.forEach((objectDescriptor, index) => {
      const created = createMapObject({ descriptor: objectDescriptor, chunkSize, seed: `${descriptor.id || 'map'}:${tile.coords?.x}:${tile.coords?.y}:${index}` });
      if (created){
        group.add(created.object);
        if (Array.isArray(created.disposables)){
          created.disposables.forEach((resource) => {
            if (resource) disposables.push(resource);
          });
        }
      }
    });
  }

  return { group, disposables };
}

function createGroundPlane({ chunkSize, color, elevation = 0 }){
  const geometry = new THREE.PlaneGeometry(chunkSize, chunkSize, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.85,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0, elevation);
  mesh.receiveShadow = true;
  return { mesh, geometry, material };
}

function createHeightfieldMesh({ descriptor, chunkSize, elevation = 0, color }){
  if (!descriptor) return null;
  const data = Array.isArray(descriptor.data) ? descriptor.data : null;
  const rows = Number(descriptor.rows) || Number(descriptor.height);
  const cols = Number(descriptor.cols) || Number(descriptor.width);
  if (!data || !rows || !cols || data.length !== rows * cols){
    console.warn('Invalid heightfield descriptor; expected rows*cols samples', descriptor);
    return null;
  }

  const geometry = new THREE.PlaneGeometry(chunkSize, chunkSize, cols - 1, rows - 1);
  const positionAttr = geometry.getAttribute('position');
  const scale = descriptor.scale || descriptor.metersPerSample || { z: descriptor.heightScale || descriptor.scaleZ || 1 };
  const scaleZ = typeof scale === 'number' ? scale : (Number(scale.z) || Number(scale[2]) || 1);

  for (let i = 0; i < positionAttr.count; i += 1){
    const heightValue = Number(data[i]) || 0;
    positionAttr.setZ(i, elevation + heightValue * scaleZ);
  }
  positionAttr.needsUpdate = true;
  geometry.computeVertexNormals();

  const materialOptions = descriptor.material || {};
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(resolveColor(materialOptions.color, color || '#6f8560')),
    roughness: Number(materialOptions.roughness ?? 0.78),
    metalness: Number(materialOptions.metalness ?? 0.08),
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return { mesh, geometry, material };
}

function createMapObject({ descriptor, chunkSize, seed }){
  if (!descriptor) return null;
  const type = descriptor.type || descriptor.kind || 'box';
  const disposables = [];
  let object = null;

  if (type === 'box'){
    const size = Array.isArray(descriptor.size) ? descriptor.size : [descriptor.width, descriptor.depth, descriptor.height];
    const width = Number(size?.[0] ?? descriptor.width ?? 40) || 40;
    const depth = Number(size?.[1] ?? descriptor.depth ?? 40) || 40;
    const height = Number(size?.[2] ?? descriptor.height ?? 20) || 20;
    const geometry = new THREE.BoxGeometry(width, depth, height);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(resolveColor(descriptor.color || descriptor.material?.color, '#8691a5')),
      roughness: Number(descriptor.material?.roughness ?? 0.6),
      metalness: Number(descriptor.material?.metalness ?? 0.2),
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = descriptor.castShadow !== false;
    mesh.receiveShadow = descriptor.receiveShadow !== false;
    mesh.position.set(0, 0, height / 2);
    object = mesh;
    disposables.push(geometry, material);
  } else if (type === 'cylinder' || type === 'tower'){
    const radiusTop = Number(descriptor.radiusTop ?? descriptor.radius ?? 8) || 8;
    const radiusBottom = Number(descriptor.radiusBottom ?? descriptor.radius ?? radiusTop) || radiusTop;
    const height = Number(descriptor.height ?? descriptor.size?.[2] ?? 30) || 30;
    const radialSegments = Math.max(3, Number(descriptor.radialSegments ?? 12) || 12);
    const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(resolveColor(descriptor.color || descriptor.material?.color, '#d6d0c2')),
      roughness: Number(descriptor.material?.roughness ?? 0.45),
      metalness: Number(descriptor.material?.metalness ?? 0.25),
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = descriptor.castShadow !== false;
    mesh.receiveShadow = descriptor.receiveShadow !== false;
    mesh.position.set(0, 0, height / 2);
    object = mesh;
    disposables.push(geometry, material);
  } else if (type === 'plane'){
    const size = Array.isArray(descriptor.size) ? descriptor.size : [descriptor.width, descriptor.depth];
    const width = Number(size?.[0] ?? descriptor.width ?? chunkSize * 0.5) || chunkSize * 0.5;
    const depth = Number(size?.[1] ?? descriptor.depth ?? chunkSize * 0.2) || chunkSize * 0.2;
    const geometry = new THREE.PlaneGeometry(width, depth, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(resolveColor(descriptor.color || descriptor.material?.color, '#dedede')),
      roughness: Number(descriptor.material?.roughness ?? 0.55),
      metalness: Number(descriptor.material?.metalness ?? 0.1),
      transparent: Boolean(descriptor.material?.transparent),
      opacity: Number(descriptor.material?.opacity ?? 1),
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = descriptor.receiveShadow !== false;
    mesh.castShadow = descriptor.castShadow === true;
    object = mesh;
    disposables.push(geometry, material);
  } else if (type === 'tree' || type === 'preset:tree'){
    const rng = createSeededRng(seed || 'tree', descriptor.position?.[0] || 0, descriptor.position?.[1] || 0);
    const tree = createProceduralTree({ rng, position: { x: 0, y: 0 } });
    object = tree.object;
    object.position.set(0, 0, 0);
    if (Array.isArray(tree.disposables)){
      tree.disposables.forEach((resource) => disposables.push(resource));
    }
  }

  if (!object) return null;

  const holder = new THREE.Group();
  holder.add(object);
  applyTransform(holder, descriptor.transform || descriptor);
  return { object: holder, disposables };
}

function applyTransform(target, descriptor){
  if (!target || !descriptor) return;
  const position = Array.isArray(descriptor.position) ? descriptor.position : null;
  if (position){
    target.position.set(Number(position[0]) || 0, Number(position[1]) || 0, Number(position[2]) || 0);
  }

  const rotation = Array.isArray(descriptor.rotation) ? descriptor.rotation : null;
  const rotationDegrees = Array.isArray(descriptor.rotationDegrees) ? descriptor.rotationDegrees : null;
  if (rotation){
    target.rotation.set(Number(rotation[0]) || 0, Number(rotation[1]) || 0, Number(rotation[2]) || 0);
  } else if (rotationDegrees){
    const toRad = Math.PI / 180;
    target.rotation.set((Number(rotationDegrees[0]) || 0) * toRad, (Number(rotationDegrees[1]) || 0) * toRad, (Number(rotationDegrees[2]) || 0) * toRad);
  }

  const scale = descriptor.scale;
  if (Array.isArray(scale)){
    target.scale.set(Number(scale[0]) || 1, Number(scale[1]) || 1, Number(scale[2]) || 1);
  } else if (typeof scale === 'number'){
    target.scale.set(scale, scale, scale);
  }
}

function resolveColor(input, fallback){
  if (!input){
    return fallback || '#ffffff';
  }
  if (typeof input === 'string'){
    return input;
  }
  if (typeof input === 'number'){
    return `#${input.toString(16).padStart(6, '0')}`;
  }
  if (typeof input === 'object' && input){
    if (Array.isArray(input)){ return `#${input.map((c) => Math.max(0, Math.min(255, Math.round(c)))).map((c) => c.toString(16).padStart(2, '0')).join('')}`; }
    if (typeof input.hex === 'string') return input.hex;
  }
  return fallback || '#ffffff';
}

function createStylizedLowpolyTemplate(){
  const group = new THREE.Group();

  const fuselageMaterial = new THREE.MeshStandardMaterial({ color: 0x314e92, metalness: 0.15, roughness: 0.55 });
  const CapsuleCtor = typeof THREE.CapsuleGeometry === 'function' ? THREE.CapsuleGeometry : null;
  const fuselageGeometry = CapsuleCtor
    ? new CapsuleCtor(4, 14, 6, 12)
    : new THREE.CylinderGeometry(4, 4, 18, 12, 1, false);
  const fuselage = new THREE.Mesh(fuselageGeometry, fuselageMaterial);
  fuselage.rotation.z = Math.PI / 2;
  group.add(fuselage);

  const wingMaterial = new THREE.MeshStandardMaterial({ color: 0xffc857, metalness: 0.1, roughness: 0.5 });
  const mainWing = new THREE.Mesh(new THREE.BoxGeometry(18, 2, 0.6), wingMaterial);
  mainWing.position.set(0, 0, 0);
  group.add(mainWing);

  const tailWing = new THREE.Mesh(new THREE.BoxGeometry(6, 1.4, 0.4), wingMaterial);
  tailWing.position.set(-5.5, 0, 1.6);
  group.add(tailWing);

  const verticalStabMaterial = new THREE.MeshStandardMaterial({ color: 0xff8c42, metalness: 0.1, roughness: 0.5 });
  const verticalStab = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.2, 2.6), verticalStabMaterial);
  verticalStab.position.set(-6.0, 0, 2.6);
  group.add(verticalStab);

  const canopyMaterial = new THREE.MeshStandardMaterial({ color: 0x7fb7f3, metalness: 0.4, roughness: 0.2, transparent: true, opacity: 0.8 });
  const canopy = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 1.2, 3.6, 12), canopyMaterial);
  canopy.rotation.z = Math.PI / 2;
  canopy.position.set(1.0, 0, 1.6);
  group.add(canopy);

  group.scale.set(0.25, 0.25, 0.25);
  group.name = 'StylizedLowpolyAircraft';
  return group;
}
