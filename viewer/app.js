// viewer/app.js - minimal three.js viewer that connects to ws://localhost:8080/ws
const HUD = document.getElementById('hud');
const MANUAL_BUTTON = document.getElementById('manual-toggle');
const INVERT_AXES_BUTTON = document.getElementById('invert-axes-toggle');
const ACCELERATE_BUTTON = document.getElementById('accelerate-forward');
const REROUTE_BUTTON = document.getElementById('reroute-waypoints');
const MODEL_SET_SELECT = document.getElementById('model-set-select');
const MODEL_SET_STATUS = document.getElementById('model-set-status');
const CONTROL_INSTRUCTIONS_LIST = document.getElementById('control-instructions');
const CONNECTION_BANNER = document.getElementById('connection-banner');
const CONNECTION_BANNER_MESSAGE = document.getElementById('connection-banner-message');
const CONNECTION_RECONNECT_BUTTON = document.getElementById('connection-reconnect');
const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';

const PLANE_STALE_TIMEOUT_MS = 5000;
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
const MAX_DISTANCE = 1000;
const MAX_ROLL = Math.PI * 0.75;
const MAX_PITCH = Math.PI * 0.5;
const ACCELERATION_RATE = 90; // units/sec^2 for forward thrust button
const MAX_FORWARD_SPEED = 260; // max forward velocity when thrust engaged
const NATURAL_DECEL = 35; // drag applied when thrust released
const SCENE_TO_SIM_SCALE = { x: 2, y: 2, z: 50 };
const MANUAL_VELOCITY_EPSILON = 0.5;
const MANUAL_ORIENTATION_EPSILON = 0.005;

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
    id: 'reroute-waypoints',
    label: 'Cycle Autopilot Route',
    description: 'Send preset waypoint loops to the simulator via the set_waypoints command.'
  }
];
let currentControlDocs = DEFAULT_CONTROL_DOCS;

let scene, camera, renderer;
const planeMeshes = new Map();   // id -> THREE.Object3D
const planeLastSeen = new Map(); // id -> timestamp
let currentFollowId = null;
let cakes = {};

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

    handleMsg(msg);
  } catch (err) {
    console.warn('bad msg', err);
  }
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
      if (!currentFollowId){
        currentFollowId = id; // follow first seen plane
        refreshSimManualOverrideState();
      }
    }

    const targetPosition = new THREE.Vector3(p[0]/2, p[1]/2, p[2]/50);

    // optional orientation: [yaw, pitch, roll]
    const o = msg.ori;
    const shouldApplyTelemetry = !(manualControlEnabled && currentFollowId === id);

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

    planeLastSeen.set(id, performance.now());

    // update camera only if we're following this plane and telemetry was applied
    if (currentFollowId === id && shouldApplyTelemetry) updateCameraTarget(mesh);

  } else if (msg.type === 'cake_drop'){
    // create simple sphere at landing_pos and remove after a while
    const id = msg.id;
    const lp = msg.landing_pos || msg.pos || [0,0,0];
    const geom = new THREE.SphereGeometry(3,12,12);
    const mat = new THREE.MeshStandardMaterial({color:0xffcc66});
    const s = new THREE.Mesh(geom, mat);
    s.position.set(lp[0]/2, lp[1]/2, lp[2]/50);
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
  const payload = {
    type: 'command',
    cmd,
    from: options.from || 'viewer-ui',
    target_id: options.targetId || currentFollowId || 'plane-1',
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
  // Procedural environment intentionally lightweight so it renders smoothly
  // while still providing parallax cues (buildings, trees, runway lines).
  const environment = new THREE.Group();
  environment.name = 'ProceduralEnvironment';

  // Primary grass field.
  const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x7ac87f, roughness: 0.85, metalness: 0.05 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4200, 4200, 1, 1), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  environment.add(ground);

  // Runway strip to emphasize forward motion.
  const runwayMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.7 });
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(1400, 180, 1, 1), runwayMaterial);
  runway.rotation.x = -Math.PI / 2;
  runway.position.set(0, 0, 0.2);
  runway.receiveShadow = true;
  environment.add(runway);

  // Center line markers on the runway.
  const markerMaterial = new THREE.MeshStandardMaterial({ color: 0xf7f7f7, roughness: 0.3 });
  for (let i = -6; i <= 6; i++){
    const marker = new THREE.Mesh(new THREE.PlaneGeometry(50, 6), markerMaterial);
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(i * 110, 0, 0.25);
    marker.receiveShadow = true;
    environment.add(marker);
  }

  // Sidewalk / taxiway stripes.
  const shoulderMaterial = new THREE.MeshStandardMaterial({ color: 0x515865, roughness: 0.6 });
  ['left', 'right'].forEach((side) => {
    const offset = side === 'left' ? -110 : 110;
    const shoulder = new THREE.Mesh(new THREE.PlaneGeometry(1400, 20), shoulderMaterial);
    shoulder.rotation.x = -Math.PI / 2;
    shoulder.position.set(0, offset, 0.22);
    shoulder.receiveShadow = true;
    environment.add(shoulder);
  });

  // Populate the outskirts with a blend of buildings and trees.
  const blockSpacing = 260;
  const blockRows = 3;
  const blockCols = 4;
  const structures = new THREE.Group();
  structures.name = 'Structures';

  for (let row = -blockRows; row <= blockRows; row++){
    for (let col = -blockCols; col <= blockCols; col++){
      if (Math.abs(row) <= 1 && Math.abs(col) <= 1) continue; // keep runway surroundings open
      const worldX = col * blockSpacing;
      const worldY = row * blockSpacing;
      if ((row + col) % 2 === 0){
        structures.add(createBuilding(worldX, worldY));
      } else {
        structures.add(createTree(worldX, worldY));
      }
    }
  }

  environment.add(structures);

  targetScene.add(environment);
}

function createBuilding(x, y){
  const buildingGroup = new THREE.Group();
  buildingGroup.position.set(x, y, 0);

  const baseHeight = 30 + Math.random() * 40;
  const palette = [0xb1c6ff, 0xd6e4ff, 0xf2bb66, 0x9fc0a8, 0xf7d6c1];
  const wallMaterial = new THREE.MeshStandardMaterial({ color: palette[Math.floor(Math.random() * palette.length)], roughness: 0.65, metalness: 0.1 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(60, 60, baseHeight), wallMaterial);
  base.position.set(0, 0, baseHeight / 2);
  base.castShadow = true;
  base.receiveShadow = true;
  buildingGroup.add(base);

  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x36393f, roughness: 0.5, metalness: 0.2 });
  const roof = new THREE.Mesh(new THREE.ConeGeometry(32, 18, 4), roofMaterial);
  roof.rotation.y = Math.PI / 4;
  roof.position.set(0, 0, baseHeight + 9);
  roof.castShadow = true;
  buildingGroup.add(roof);

  return buildingGroup;
}

function createTree(x, y){
  const tree = new THREE.Group();
  tree.position.set(x + (Math.random() * 30 - 15), y + (Math.random() * 30 - 15), 0);

  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x8c5a2b, roughness: 0.8 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 20, 8), trunkMaterial);
  trunk.position.set(0, 0, 10);
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  tree.add(trunk);

  const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0x2f7d32, roughness: 0.6 });
  const foliage = new THREE.Mesh(new THREE.ConeGeometry(20, 40, 10), foliageMaterial);
  foliage.position.set(0, 0, 35);
  foliage.castShadow = true;
  tree.add(foliage);

  return tree;
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
  renderer.render(scene, camera);
}

function removeStalePlanes(){
  const now = performance.now();
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
}

function updateCameraTarget(mesh){
  camera.position.set(mesh.position.x - 40, mesh.position.y + 0, mesh.position.z + 20);
  camera.lookAt(mesh.position);
}

function updateManualOverrideIndicator(id, isActive){
  manualOverrideStateByPlane.set(id, Boolean(isActive));
  if (id === currentFollowId){
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
  if (!currentFollowId){
    setSimManualOverrideActive(false);
    return;
  }
  const active = manualOverrideStateByPlane.get(currentFollowId) || false;
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
  const mesh = planeMeshes.get(currentFollowId);
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

    pos.x = clamp(pos.x, -MAX_DISTANCE, MAX_DISTANCE);
    pos.y = clamp(pos.y, -MAX_DISTANCE, MAX_DISTANCE);
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
  const mesh = planeMeshes.get(currentFollowId);
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
    targetId: currentFollowId || undefined,
  });
}

function maybeSendManualOverride(update){
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const targetId = update.targetId || currentFollowId || 'plane-1';
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
