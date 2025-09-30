// viewer/app.js - minimal three.js viewer that connects to ws://localhost:8080/ws
import { ChaseCam } from './camera/ChaseCam.js';
import {
  readControls,
  onKeyDown as registerControlKeyDown,
  onKeyUp as registerControlKeyUp,
  setInvertAxes as inputSetInvertAxes,
  setThrottleHold as inputSetThrottleHold,
} from './control/Input.js';
import { createSandboxWorld } from './world/SandboxWorldAdapter.js';
import { loadGLTFAsset } from './terra/glbLoader.js';
import {
  DEFAULT_MAP_ID,
  WORLD_CHUNK_RADIUS,
  WORLD_CHUNK_SIZE,
  WORLD_SEED,
  buildMapManifestUrl,
  deriveAssetRootFromUrl,
  normalizeAssetRootPath,
  normalizeMapDescriptor,
} from './mapNormalization.mjs';
import { SolarSystemWorld } from './cloud-of-orbs/SolarSystemWorld.js';
import { getRegistrySnapshot as getPlanetRegistrySnapshot } from './cloud-of-orbs/planets/index.js';

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

const MATCH_STATUS = document.getElementById('match-status');
const MATCH_BUTTONS = new Map([
  ['match-1', document.getElementById('match-1-button')],
  ['match-2', document.getElementById('match-2-button')],
  ['match-3', document.getElementById('match-3-button')],
  ['match-4', document.getElementById('match-4-button')],
]);

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
inputSetInvertAxes(invertAxesEnabled);
let mapStorageUnavailable = false;
const MIN_ALTITUDE = 0;
const MAX_ALTITUDE = 400;
const MAX_ROLL = Math.PI * 0.75;
const MAX_PITCH = Math.PI * 0.5;
const MAX_YAW_RATE = Math.PI * 0.8;
const MAX_PITCH_RATE = Math.PI * 0.9;
const MAX_ROLL_RATE = Math.PI * 1.2;
const THRUST_FORCE = 240;
const DRAG_COEFFICIENT = 0.65;
const MAX_AIRSPEED = 340;
const THROTTLE_RESPONSE_RATE = 2.5;
const SCENE_TO_SIM_SCALE = { x: 2, y: 2, z: 50 };
const MANUAL_VELOCITY_EPSILON = 0.5;
const MANUAL_ORIENTATION_EPSILON = 0.005;
const WORLD_REBASE_DISTANCE = 1200;
const WORLD_REBASE_DISTANCE_SQ = WORLD_REBASE_DISTANCE * WORLD_REBASE_DISTANCE;
const TERRAIN_SEED = `${WORLD_SEED}:terrain`;
const RIVER_SEED = `${WORLD_SEED}:river`;
const TERRAIN_FLATTEN_RADIUS = 580;
const TERRAIN_MAX_HEIGHT = 160;
const RIVER_THRESHOLD = 0.38;
const RIVER_SAMPLING_STEP = 180;

function seededScalar(label){
  const generator = xmur3(label);
  return generator() / 4294967295;
}

const TERRAIN_RANDOM = {
  phaseX: seededScalar(`${TERRAIN_SEED}:phaseX`) * Math.PI * 2,
  phaseY: seededScalar(`${TERRAIN_SEED}:phaseY`) * Math.PI * 2,
  ridgePhase: seededScalar(`${TERRAIN_SEED}:ridgePhase`) * Math.PI * 2,
  ridgeFrequency: 0.0006 + seededScalar(`${TERRAIN_SEED}:ridgeFrequency`) * 0.0004,
  detailPhase: seededScalar(`${TERRAIN_SEED}:detailPhase`) * Math.PI * 2,
};

const RIVER_RANDOM = {
  basePhase: seededScalar(`${RIVER_SEED}:phase` ) * Math.PI * 2,
  diagonalPhase: seededScalar(`${RIVER_SEED}:diagPhase`) * Math.PI * 2,
};

function lerp(a, b, t){
  return a + (b - a) * t;
}

function smoothStep(t){
  return t * t * (3 - 2 * t);
}

function valueNoise2D(x, y, label){
  const x0 = Math.floor(x);
  const x1 = x0 + 1;
  const y0 = Math.floor(y);
  const y1 = y0 + 1;
  const sx = smoothStep(x - x0);
  const sy = smoothStep(y - y0);
  const n00 = seededScalar(`${label}:${x0}:${y0}`);
  const n10 = seededScalar(`${label}:${x1}:${y0}`);
  const n01 = seededScalar(`${label}:${x0}:${y1}`);
  const n11 = seededScalar(`${label}:${x1}:${y1}`);
  const ix0 = lerp(n00, n10, sx);
  const ix1 = lerp(n01, n11, sx);
  return lerp(ix0, ix1, sy);
}

function fbmNoise(x, y, label, octaves = 4){
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let maxAmplitude = 0;
  for (let i = 0; i < octaves; i += 1){
    total += valueNoise2D(x * frequency, y * frequency, `${label}:octave:${i}`) * amplitude;
    maxAmplitude += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return maxAmplitude ? total / maxAmplitude : 0;
}

function getRiverNoise(x, y){
  const base = Math.sin(x * 0.00055 + RIVER_RANDOM.basePhase);
  const diagonal = Math.sin((x + y) * 0.00042 + RIVER_RANDOM.diagonalPhase);
  return base + diagonal;
}

function getRiverMask(x, y){
  const widthVariance = 0.6 + Math.sin((x - y) * 0.00025 + RIVER_RANDOM.basePhase * 0.5) * 0.25;
  const riverValue = Math.abs(getRiverNoise(x, y));
  const normalized = Math.max(0, RIVER_THRESHOLD - (riverValue * widthVariance));
  return Math.min(1, normalized / RIVER_THRESHOLD);
}

function getTerrainHeight(x, y){
  const offsetLargeX = (x + Math.cos(TERRAIN_RANDOM.phaseX) * 1200);
  const offsetLargeY = (y + Math.sin(TERRAIN_RANDOM.phaseX) * 1200);
  const offsetDetailX = (x + Math.cos(TERRAIN_RANDOM.detailPhase) * 320);
  const offsetDetailY = (y + Math.sin(TERRAIN_RANDOM.detailPhase) * 320);
  const largeScale = fbmNoise(offsetLargeX * 0.00035, offsetLargeY * 0.00035, `${TERRAIN_SEED}:large`, 5);
  const detail = fbmNoise(offsetDetailX * 0.0015, offsetDetailY * 0.0015, `${TERRAIN_SEED}:detail`, 3);
  const ridge = Math.max(0, Math.sin(x * TERRAIN_RANDOM.ridgeFrequency + TERRAIN_RANDOM.ridgePhase) * Math.cos(y * (TERRAIN_RANDOM.ridgeFrequency * 0.8) + TERRAIN_RANDOM.phaseY));
  let height = Math.pow(largeScale, 2.2) * TERRAIN_MAX_HEIGHT;
  height += detail * 18;
  height += ridge * 48;

  const riverMask = getRiverMask(x, y);
  if (riverMask > 0){
    height -= (18 + largeScale * 24) * riverMask;
  }

  const distance = Math.sqrt(x * x + y * y);
  if (distance < TERRAIN_FLATTEN_RADIUS){
    const t = distance / TERRAIN_FLATTEN_RADIUS;
    height *= t * t;
  }

  return Math.max(-6, height);
}

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

const SURFACE_BODY_BACKGROUND = 'linear-gradient(180deg, #bcd9ff 0%, #f1f6ff 45%, #d7e8ff 100%)';
const SPACE_BODY_BACKGROUND = 'radial-gradient(circle at 50% 20%, #071427 0%, #030912 55%, #010308 100%)';
const SURFACE_CAMERA_FAR = 10000;
const SPACE_CAMERA_FAR = 260000;
const SPACE_ENTRY_ALTITUDE_METERS = 10000;
const SPACE_EXIT_ALTITUDE_METERS = 9000;

const SURFACE_ENVIRONMENT = Object.freeze({
  background: 0xbfd3ff,
  fog: null,
  hemisphere: { skyColor: 0xe4f1ff, groundColor: 0x3a5d2f, intensity: 0.8 },
  sun: { color: 0xffffff, intensity: 0.85, position: [-180, 220, 260] },
});

const SPACE_ENVIRONMENT = Object.freeze({
  background: 0x050b16,
  fog: { color: 0x050b16, near: 12000, far: 36000 },
  hemisphere: { skyColor: 0x3a4c72, groundColor: 0x040608, intensity: 0.45 },
  sun: { color: 0xfff0d2, intensity: 2.15, position: [-5200, 4200, 2600] },
});

const PLANET_REGISTRY_SNAPSHOT = getPlanetRegistrySnapshot();

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
    label: 'Max Throttle Hold',
    description: 'Toggle sustained throttle with T or the HUD button. Gamepad right trigger also works.'
  },
  {
    id: 'keyboard',
    label: 'Flight Keys',
    description: 'Use W/S or Up/Down for pitch, A/D or Left/Right for roll, and Q/E for yaw.'
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
  },
  {
    id: 'match-controls',
    label: 'Match Presets',
    description: 'Choose Match 1–4 to instantly load tailored waypoint routes and prep for orbital escape.'
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
let solarSystemWorld = null;
let spaceModeActive = false;
let pendingSurfaceRebuildOptions = null;
let hemisphereLight = null;
let sunLight = null;
let activeMatchId = null;
let currentFollowAltitude = 0;

// ----- Aircraft model (optional GLTF or procedural set) -----
let gltfLoader = null;
let gltfLoaderUnavailable = false;
let aircraftLoadError = false;
let aircraftTemplate = null;
let aircraftLoadPromise = null;
const pendingTelemetry = [];
const planeResources = new Map();

function setPlaneMeshesVisible(visible){
  const desired = Boolean(visible);
  planeMeshes.forEach((mesh) => {
    if (mesh){
      mesh.visible = desired;
    }
  });
}

// ----- Manual control / HUD state -----
let manualControlEnabled = false;
let manualMovementActive = false;
let connectionStatusKey = CONNECTION_STATUS_KEYS.CONNECTING;
let connectionStatus = getConnectionStatusLabel(connectionStatusKey);
let lastFrameTime = null;
let manualFlightState = null;
let manualFlightFollowId = null;
let manualAirspeed = 0;
let chaseCam = null;
let throttleHoldEngaged = false;

const TMP_VECTOR = new THREE.Vector3();
const TMP_ACCEL = new THREE.Vector3();
const TMP_FORWARD = new THREE.Vector3();
const TMP_EULER = new THREE.Euler(0, 0, 0, 'ZYX');
const TMP_QUAT = new THREE.Quaternion();
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
  generator: 'sandbox',
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

const MATCH_PRESETS = [
  {
    id: 'match-1',
    label: 'Match 1',
    description: 'Balanced runway loop with gentle turns and smooth altitude changes.',
    autopilot: {
      loop: true,
      arrivalTolerance: 80,
      waypoints: [
        [-800, -400, 1200],
        [-200, 0, 1350],
        [600, 420, 1200],
        [200, -200, 1100],
      ],
    },
  },
  {
    id: 'match-2',
    label: 'Match 2',
    description: 'Aggressive harbour climb that threads coastal peaks and dives back to the runway.',
    autopilot: {
      loop: true,
      arrivalTolerance: 70,
      waypoints: [
        [-600, -300, 1000],
        [-150, 260, 1500],
        [520, 520, 1400],
        [420, -280, 1050],
      ],
    },
  },
  {
    id: 'match-3',
    label: 'Match 3',
    description: 'High ridge sprint weaving through mountain saddles before a steep valley drop.',
    autopilot: {
      loop: true,
      arrivalTolerance: 75,
      waypoints: [
        [-950, -520, 900],
        [-350, 420, 1600],
        [580, 760, 1500],
        [420, -100, 1800],
        [-220, -460, 1200],
      ],
    },
  },
  {
    id: 'match-4',
    label: 'Match 4',
    description: 'Stratosphere dash that slings the craft toward thin air before lining up a long glide home.',
    autopilot: {
      loop: true,
      arrivalTolerance: 90,
      waypoints: [
        [-1000, -800, 1400],
        [-300, 200, 2200],
        [700, 540, 2600],
        [300, -300, 2800],
        [-450, -650, 2000],
      ],
    },
  },
];

const AUTOPILOT_PRESETS = MATCH_PRESETS.map((preset) => ({
  id: preset.id,
  label: preset.label,
  loop: preset.autopilot.loop,
  arrivalTolerance: preset.autopilot.arrivalTolerance,
  waypoints: preset.autopilot.waypoints,
}));

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
setupMatchControls();
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
  setManualMovementActive(false);
  throttleHoldEngaged = false;
  inputSetThrottleHold(false);
  resetManualFlightState();
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
      if (spaceModeActive){
        mesh.visible = false;
      }
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

    if (followId === id){
      const altitudeMeters = Array.isArray(p) && p.length >= 3 ? Number(p[2]) || 0 : 0;
      currentFollowAltitude = Math.max(0, altitudeMeters);
      updateSpaceTransitionState({ altitude: currentFollowAltitude, planeId: id });
      updateHudStatus();
    }

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
        if (pendingAutopilotPreset.matchId){
          activeMatchId = pendingAutopilotPreset.matchId;
        }
      } else if (status === 'error'){
        if (MATCH_STATUS && pendingAutopilotPreset?.label){
          MATCH_STATUS.textContent = `Match update failed: ${pendingAutopilotPreset.label} not applied.`;
        }
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
  updateMatchUiState();
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
      matchId: preset.id,
    };
    updateRerouteButtonState();
  }
}

function syncCruiseControllerTarget(options = {}){
  const preset = options.forceBaseline || !throttleHoldEngaged
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

  function getHeightAt(x, y){
    const originOffset = ensureWorldOriginOffset();
    const globalX = x + originOffset.x;
    const globalY = y + originOffset.y;
    const chunkX = Math.floor(globalX / chunkSize);
    const chunkY = Math.floor(globalY / chunkSize);
    const key = chunkKey(chunkX, chunkY);
    const tile = tiles.get(key);
    const chunkOriginX = chunkX * chunkSize;
    const chunkOriginY = chunkY * chunkSize;
    const localX = globalX - chunkOriginX;
    const localY = globalY - chunkOriginY;
    if (tile?.heightSampler){
      return tile.heightSampler(localX, localY);
    }
    if (tile){
      return Number(tile.baseHeight || 0) || 0;
    }
    if (fallbackType === 'procedural'){
      return getTerrainHeight(globalX, globalY);
    }
    return 0;
  }

  function getOriginOffset(){
    return ensureWorldOriginOffset().clone();
  }

  function getObstaclesNear(x, y, radius = chunkSize){
    const originOffset = ensureWorldOriginOffset();
    const globalX = x + originOffset.x;
    const globalY = y + originOffset.y;
    const chunkX = Math.floor(globalX / chunkSize);
    const chunkY = Math.floor(globalY / chunkSize);
    const results = [];
    for (let dx = -1; dx <= 1; dx += 1){
      for (let dy = -1; dy <= 1; dy += 1){
        const entry = chunkMap.get(chunkKey(chunkX + dx, chunkY + dy));
        if (!entry?.obstacles?.length) continue;
        entry.obstacles.forEach((obstacle) => {
          if (!obstacle?.worldPosition) return;
          const dxWorld = obstacle.worldPosition.x - globalX;
          const dyWorld = obstacle.worldPosition.y - globalY;
          const combined = (radius + (obstacle.radius ?? 0));
          if (dxWorld * dxWorld + dyWorld * dyWorld <= combined * combined){
            results.push(obstacle);
          }
        });
      }
    }
    return results;
  }

  function disposeChunk(chunkEntry){
    if (!chunkEntry) return;
    chunkEntry.disposed = true;
    if (Array.isArray(chunkEntry.pending)){
      chunkEntry.pending.length = 0;
    }
    if (Array.isArray(chunkEntry.obstacles)){
      chunkEntry.obstacles.length = 0;
    }
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

  return { update, handleOriginShift, dispose: disposeAll, getHeightAt, getOriginOffset, getObstaclesNear };
}

function buildChunkContents({ coords, chunkSize, rng }){
  const group = new THREE.Group();
  const disposables = [];

  const chunkOrigin = {
    x: coords.x * chunkSize,
    y: coords.y * chunkSize,
  };

  const sampleHeight = (localX, localY) => getTerrainHeight(chunkOrigin.x + localX, chunkOrigin.y + localY);
  const sampleRiverMask = (localX, localY) => getRiverMask(chunkOrigin.x + localX, chunkOrigin.y + localY);

  const baseHue = 0.31 + (rng() - 0.5) * 0.05;
  const baseSaturation = 0.48 + (rng() - 0.5) * 0.1;
  const baseLightness = 0.46 + (rng() - 0.5) * 0.1;
  const groundColor = new THREE.Color().setHSL(baseHue, baseSaturation, baseLightness);
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: groundColor,
    roughness: 0.87,
    metalness: 0.05,
  });
  const groundGeometry = new THREE.PlaneGeometry(chunkSize, chunkSize, 32, 32);
  applyTerrainToGeometry({ geometry: groundGeometry, chunkOrigin });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  disposables.push(groundMaterial, groundGeometry);

  const overlayCount = 2;
  for (let i = 0; i < overlayCount; i += 1){
    const overlayWidth = chunkSize * (0.5 + rng() * 0.3);
    const overlayDepth = chunkSize * (0.08 + rng() * 0.05);
    const overlayGeometry = new THREE.PlaneGeometry(overlayWidth, overlayDepth, 1, 1);
    const overlayMaterial = new THREE.MeshStandardMaterial({
      color: groundColor.clone().offsetHSL((rng() - 0.5) * 0.05, (rng() - 0.5) * 0.1, (rng() - 0.5) * 0.12),
      roughness: 0.76,
      metalness: 0.04,
      transparent: true,
      opacity: 0.35,
    });
    const overlay = new THREE.Mesh(overlayGeometry, overlayMaterial);
    overlay.rotation.x = -Math.PI / 2;
    const overlayLocalX = (rng() - 0.5) * chunkSize * 0.5;
    const overlayLocalY = (rng() - 0.5) * chunkSize * 0.5;
    const overlayHeight = sampleHeight(overlayLocalX, overlayLocalY) + 0.1 + rng() * 0.05;
    overlay.position.set(overlayLocalX, overlayLocalY, overlayHeight);
    overlay.receiveShadow = true;
    group.add(overlay);
    disposables.push(overlayMaterial, overlayGeometry);
  }

  const riverInfo = evaluateRiverForChunk({ chunkOrigin, chunkSize, sampler: sampleRiverMask });
  if (riverInfo){
    const river = createRiverPatch({ info: riverInfo, chunkOrigin, chunkSize, heightSampler: sampleHeight });
    if (river?.mesh){
      group.add(river.mesh);
      disposables.push(river.material, river.geometry);
    }
  }

  if (Math.abs(coords.x) <= 1){
    const baseHeight = sampleHeight(0, 0);
    addRunwaySegment(group, chunkSize, rng, disposables, baseHeight);
  }

  const centerHeight = sampleHeight(0, 0);
  if (centerHeight > 70 && rng() > 0.55){
    const mountainPosX = (rng() - 0.5) * chunkSize * 0.5;
    const mountainPosY = (rng() - 0.5) * chunkSize * 0.5;
    const mountain = createMountainPeak({
      rng,
      position: {
        x: mountainPosX,
        y: mountainPosY,
      },
      baseHeight: sampleHeight(mountainPosX, mountainPosY),
    });
    if (mountain){
      group.add(mountain.object);
      disposables.push(...mountain.disposables);
    }
  }

  const townRoll = rng();
  if (townRoll > 0.82 && Math.abs(coords.x) > 1){
    const townCenter = {
      x: (rng() - 0.5) * chunkSize * 0.5,
      y: (rng() - 0.5) * chunkSize * 0.5,
    };
    if (sampleRiverMask(townCenter.x, townCenter.y) < 0.35){
      const town = createProceduralTown({ rng, center: townCenter, heightSampler: sampleHeight });
      if (town){
        group.add(town.object);
        disposables.push(...town.disposables);
      }
    }
  }

  const scatterCount = 12 + Math.floor(rng() * 10);
  for (let i = 0; i < scatterCount; i += 1){
    const localX = (rng() - 0.5) * chunkSize * 0.95;
    const localY = (rng() - 0.5) * chunkSize * 0.95;
    if (Math.abs(coords.x) <= 1 && Math.abs(localX) < 140){
      continue;
    }
    const baseHeight = sampleHeight(localX, localY);
    if (sampleRiverMask(localX, localY) > 0.45){
      continue;
    }
    const slope = Math.abs(sampleHeight(localX + 6, localY) - baseHeight) + Math.abs(sampleHeight(localX, localY + 6) - baseHeight);
    if (slope > 20 && rng() > 0.3){
      continue;
    }

    const elevationBias = Math.max(0, Math.min(1, (baseHeight - 25) / 70));
    const rockThreshold = 0.6 - elevationBias * 0.25;
    const buildingThreshold = 0.78 - elevationBias * 0.2;
    const houseThreshold = 0.55 - elevationBias * 0.15;
    const roll = rng();
    if (baseHeight > 65 && roll > rockThreshold){
      const rock = createProceduralRock({ rng, position: { x: localX, y: localY }, baseHeight });
      group.add(rock.object);
      disposables.push(...rock.disposables);
    } else if (roll > buildingThreshold){
      const building = createProceduralBuilding({ rng, position: { x: localX, y: localY }, baseHeight });
      group.add(building.object);
      disposables.push(...building.disposables);
    } else if (roll > houseThreshold){
      const house = createProceduralHouse({ rng, position: { x: localX, y: localY }, baseHeight });
      group.add(house.object);
      disposables.push(...house.disposables);
    } else {
      const tree = createProceduralTree({ rng, position: { x: localX, y: localY }, baseHeight });
      group.add(tree.object);
      disposables.push(...tree.disposables);
    }
  }

  if (riverInfo && rng() > 0.4){
    const riversideTreeCount = 4 + Math.floor(rng() * 4);
    for (let i = 0; i < riversideTreeCount; i += 1){
      const offsetDistance = (rng() > 0.5 ? 1 : -1) * (15 + rng() * 25);
      const along = (rng() - 0.5) * chunkSize * 0.4;
      const sin = Math.sin(riverInfo.angle);
      const cos = Math.cos(riverInfo.angle);
      const localX = riverInfo.localCenter.x + cos * along - sin * offsetDistance;
      const localY = riverInfo.localCenter.y + sin * along + cos * offsetDistance;
      const baseHeight = sampleHeight(localX, localY);
      if (sampleRiverMask(localX, localY) > 0.4){
        continue;
      }
      const tree = createProceduralTree({ rng, position: { x: localX, y: localY }, baseHeight });
      group.add(tree.object);
      disposables.push(...tree.disposables);
    }
  }

  return { group, disposables };
}

function applyTerrainToGeometry({ geometry, chunkOrigin }){
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return;
  const positionAttr = geometry.getAttribute('position');
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  for (let i = 0; i < positionAttr.count; i += 1){
    const localX = positionAttr.getX(i);
    const localY = positionAttr.getY(i);
    const height = getTerrainHeight(chunkOrigin.x + localX, chunkOrigin.y + localY);
    positionAttr.setZ(i, height);
    if (height < minHeight) minHeight = height;
    if (height > maxHeight) maxHeight = height;
  }
  positionAttr.needsUpdate = true;
  geometry.computeVertexNormals();
  return { minHeight, maxHeight };
}

function evaluateRiverForChunk({ chunkOrigin, chunkSize, sampler }){
  if (!chunkOrigin || typeof sampler !== 'function') return null;
  const halfSize = chunkSize / 2;
  let strongestMask = 0;
  let bestSample = null;
  for (let x = -halfSize; x <= halfSize; x += RIVER_SAMPLING_STEP){
    for (let y = -halfSize; y <= halfSize; y += RIVER_SAMPLING_STEP){
      const mask = sampler(x, y);
      if (mask > strongestMask){
        strongestMask = mask;
        bestSample = { x, y };
      }
    }
  }
  if (!bestSample || strongestMask < 0.25){
    return null;
  }
  const worldX = chunkOrigin.x + bestSample.x;
  const worldY = chunkOrigin.y + bestSample.y;
  const gradX = getRiverNoise(worldX + 25, worldY) - getRiverNoise(worldX - 25, worldY);
  const gradY = getRiverNoise(worldX, worldY + 25) - getRiverNoise(worldX, worldY - 25);
  const angle = Math.atan2(gradY, gradX) + Math.PI / 2;
  return {
    angle,
    strength: strongestMask,
    worldCenter: { x: worldX, y: worldY },
    localCenter: { x: bestSample.x, y: bestSample.y },
  };
}

function createRiverPatch({ info, chunkOrigin, chunkSize, heightSampler }){
  if (!info) return null;
  const width = 30 + info.strength * 120;
  const length = Math.max(chunkSize * 1.1, 400 + info.strength * 320);
  const geometry = new THREE.PlaneGeometry(length, width, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: 0x335fd8,
    roughness: 0.32,
    metalness: 0.12,
    transparent: true,
    opacity: 0.86,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = info.angle;
  const localX = info.worldCenter.x - chunkOrigin.x;
  const localY = info.worldCenter.y - chunkOrigin.y;
  const baseHeight = typeof heightSampler === 'function' ? heightSampler(localX, localY) : getTerrainHeight(info.worldCenter.x, info.worldCenter.y);
  mesh.position.set(localX, localY, baseHeight - 1.2);
  mesh.receiveShadow = false;
  return { mesh, geometry, material };
}

function createProceduralTown({ rng, center, heightSampler }){
  if (!rng || !center || typeof heightSampler !== 'function') return null;
  const town = new THREE.Group();
  town.name = 'ProceduralTown';
  const baseHeight = heightSampler(center.x, center.y);
  town.position.set(center.x, center.y, baseHeight);
  const disposables = [];

  const plazaGeometry = new THREE.CircleGeometry(120 + rng() * 60, 18);
  const plazaMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.08, 0.18, 0.62), roughness: 0.7, metalness: 0.08, transparent: true, opacity: 0.92 });
  const plaza = new THREE.Mesh(plazaGeometry, plazaMaterial);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(0, 0, 0.05);
  plaza.receiveShadow = true;
  town.add(plaza);
  disposables.push(plazaGeometry, plazaMaterial);

  const structureCount = 6 + Math.floor(rng() * 6);
  for (let i = 0; i < structureCount; i += 1){
    const angle = rng() * Math.PI * 2;
    const radius = (rng() ** 0.6) * 180;
    const offsetX = Math.cos(angle) * radius;
    const offsetY = Math.sin(angle) * radius;
    const localHeight = heightSampler(center.x + offsetX, center.y + offsetY) - baseHeight;
    const roll = rng();
    let created;
    if (roll > 0.7){
      created = createProceduralBuilding({ rng, position: { x: offsetX, y: offsetY }, baseHeight: localHeight });
    } else {
      created = createProceduralHouse({ rng, position: { x: offsetX, y: offsetY }, baseHeight: localHeight });
    }
    if (created){
      town.add(created.object);
      if (Array.isArray(created.disposables)){
        created.disposables.forEach((resource) => disposables.push(resource));
      }
    }
  }

  const treeCount = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < treeCount; i += 1){
    const angle = rng() * Math.PI * 2;
    const radius = 140 + rng() * 100;
    const offsetX = Math.cos(angle) * radius;
    const offsetY = Math.sin(angle) * radius;
    const localHeight = heightSampler(center.x + offsetX, center.y + offsetY) - baseHeight;
    const tree = createProceduralTree({ rng, position: { x: offsetX, y: offsetY }, baseHeight: localHeight });
    town.add(tree.object);
    if (Array.isArray(tree.disposables)){
      tree.disposables.forEach((resource) => disposables.push(resource));
    }
  }

  return { object: town, disposables };
}

function createProceduralHouse({ rng, position, baseHeight = 0 }){
  const house = new THREE.Group();
  house.name = 'ProceduralHouse';
  house.position.set(position.x, position.y, baseHeight);
  const disposables = [];

  const width = 22 + rng() * 16;
  const depth = 24 + rng() * 18;
  const height = 12 + rng() * 8;
  const bodyGeometry = new THREE.BoxGeometry(width, depth, height);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.06 + rng() * 0.05, 0.25 + rng() * 0.2, 0.72 + rng() * 0.1),
    roughness: 0.68,
    metalness: 0.08,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.castShadow = true;
  body.receiveShadow = true;
  body.position.set(0, 0, height / 2);
  house.add(body);
  disposables.push(bodyGeometry, bodyMaterial);

  const roofHeight = 6 + rng() * 4;
  const roofGeometry = new THREE.ConeGeometry(Math.max(width, depth) * 0.55, roofHeight, 4);
  const roofMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.02 + rng() * 0.04, 0.4, 0.2 + rng() * 0.1),
    roughness: 0.5,
    metalness: 0.18,
  });
  const roof = new THREE.Mesh(roofGeometry, roofMaterial);
  roof.rotation.y = Math.PI / 4;
  roof.position.set(0, 0, height + roofHeight / 2);
  roof.castShadow = true;
  roof.receiveShadow = true;
  house.add(roof);
  disposables.push(roofGeometry, roofMaterial);

  if (rng() > 0.6){
    const chimneyGeometry = new THREE.BoxGeometry(4 + rng() * 2, 4 + rng() * 2, 6 + rng() * 4);
    const chimneyMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0, 0, 0.3 + rng() * 0.1),
      roughness: 0.58,
    });
    const chimney = new THREE.Mesh(chimneyGeometry, chimneyMaterial);
    chimney.position.set(width * 0.2, depth * -0.15, height + roofHeight * 0.6);
    chimney.castShadow = true;
    chimney.receiveShadow = true;
    house.add(chimney);
    disposables.push(chimneyGeometry, chimneyMaterial);
  }

  house.rotation.z = (rng() - 0.5) * 0.1;
  house.rotation.y = rng() * Math.PI * 2;

  return { object: house, disposables };
}

function createProceduralRock({ rng, position, baseHeight = 0 }){
  const rock = new THREE.Group();
  rock.name = 'ProceduralRock';
  rock.position.set(position.x, position.y, baseHeight);
  const disposables = [];

  const radius = 8 + rng() * 18;
  const detail = 1 + Math.floor(rng() * 2);
  const geometry = new THREE.IcosahedronGeometry(radius, detail);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.08 + rng() * 0.04, 0.1 + rng() * 0.05, 0.36 + rng() * 0.08),
    roughness: 0.92,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(0, 0, radius * 0.6);
  mesh.scale.set(1, 1 + rng() * 0.4, 0.7 + rng() * 0.4);
  mesh.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
  rock.add(mesh);
  disposables.push(geometry, material);

  return { object: rock, disposables };
}

function createMountainPeak({ rng, position, baseHeight = 0 }){
  if (!rng || !position) return null;
  const peak = new THREE.Group();
  peak.name = 'ProceduralMountainPeak';
  const height = 60 + rng() * 80;
  const radius = height * (0.4 + rng() * 0.25);
  const geometry = new THREE.ConeGeometry(radius, height, 6 + Math.floor(rng() * 6));
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.07 + rng() * 0.03, 0.12, 0.32 + rng() * 0.1),
    roughness: 0.9,
    metalness: 0.06,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(0, 0, height / 2);
  peak.add(mesh);

  peak.position.set(position.x, position.y, baseHeight);
  peak.rotation.y = rng() * Math.PI * 2;
  peak.rotation.x = (rng() - 0.5) * 0.1;

  return { object: peak, disposables: [geometry, material] };
}

function addRunwaySegment(group, chunkSize, rng, disposables, elevation = 0){
  const runwayMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.72, metalness: 0.12 });
  const runwayGeometry = new THREE.PlaneGeometry(chunkSize, 180, 1, 1);
  const runway = new THREE.Mesh(runwayGeometry, runwayMaterial);
  runway.rotation.x = -Math.PI / 2;
  runway.position.set(0, 0, elevation + 0.12);
  runway.receiveShadow = true;
  group.add(runway);
  disposables.push(runwayMaterial, runwayGeometry);

  const shoulderMaterial = new THREE.MeshStandardMaterial({ color: 0x515865, roughness: 0.62, metalness: 0.08 });
  const shoulderGeometry = new THREE.PlaneGeometry(chunkSize, 26, 1, 1);
  const leftShoulder = new THREE.Mesh(shoulderGeometry, shoulderMaterial);
  const rightShoulder = new THREE.Mesh(shoulderGeometry, shoulderMaterial);
  leftShoulder.rotation.x = -Math.PI / 2;
  rightShoulder.rotation.x = -Math.PI / 2;
  leftShoulder.position.set(0, -110, elevation + 0.13);
  rightShoulder.position.set(0, 110, elevation + 0.13);
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
    marker.position.set(0, (i / markerCount) * (chunkSize * 0.5), elevation + 0.14);
    marker.receiveShadow = true;
    group.add(marker);
  }
  disposables.push(markerMaterial, markerGeometry);

  if (rng() > 0.6){
    const centerGlowMaterial = new THREE.MeshStandardMaterial({ color: 0xf5d46b, emissive: new THREE.Color(0xf5d46b), emissiveIntensity: 0.35, roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0.25 });
    const centerGlowGeometry = new THREE.PlaneGeometry(chunkSize * 0.2, 40, 1, 1);
    const centerGlow = new THREE.Mesh(centerGlowGeometry, centerGlowMaterial);
    centerGlow.rotation.x = -Math.PI / 2;
    centerGlow.position.set(0, 0, elevation + 0.15);
    group.add(centerGlow);
    disposables.push(centerGlowMaterial, centerGlowGeometry);
  }
}

function createProceduralTree({ rng, position, baseHeight = 0 }){
  const tree = new THREE.Group();
  tree.name = 'ProceduralTree';
  tree.position.set(position.x, position.y, baseHeight);
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

function createProceduralBuilding({ rng, position, baseHeight = 0 }){
  const building = new THREE.Group();
  building.name = 'ProceduralBuilding';
  building.position.set(position.x, position.y, baseHeight);
  const disposables = [];

  const baseWidth = 40 + rng() * 36;
  const baseDepth = 40 + rng() * 36;
  const structureHeight = 24 + rng() * 32;
  const wallColor = new THREE.Color().setHSL(0.55 + rng() * 0.2, 0.35 + rng() * 0.25, 0.58 + rng() * 0.18);
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: wallColor,
    roughness: 0.65,
    metalness: 0.12,
  });
  const baseGeometry = new THREE.BoxGeometry(baseWidth, baseDepth, structureHeight);
  const baseMesh = new THREE.Mesh(baseGeometry, wallMaterial);
  baseMesh.position.set(0, 0, structureHeight / 2);
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
  roofMesh.position.set(0, 0, structureHeight + roofHeight / 2);
  roofMesh.castShadow = true;
  roofMesh.receiveShadow = true;
  building.add(roofMesh);
  disposables.push(roofGeometry, roofMaterial);

  if (rng() > 0.45){
    const annexWidth = baseWidth * (0.45 + rng() * 0.25);
    const annexDepth = baseDepth * (0.4 + rng() * 0.25);
    const annexHeight = structureHeight * (0.35 + rng() * 0.3);
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
    const hangarHeight = structureHeight * 0.4;
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

function ensureSolarSystemWorld(){
  if (!scene || !camera) return null;
  if (!solarSystemWorld){
    solarSystemWorld = new SolarSystemWorld({
      scene,
      camera,
      planetRegistry: PLANET_REGISTRY_SNAPSHOT,
    });
    solarSystemWorld.exitSystemView();
  }
  return solarSystemWorld;
}

function applySurfaceEnvironment(){
  if (!scene) return;
  scene.background = new THREE.Color(SURFACE_ENVIRONMENT.background);
  scene.fog = SURFACE_ENVIRONMENT.fog
    ? new THREE.Fog(SURFACE_ENVIRONMENT.fog.color, SURFACE_ENVIRONMENT.fog.near, SURFACE_ENVIRONMENT.fog.far)
    : null;
  if (hemisphereLight){
    hemisphereLight.color.setHex(SURFACE_ENVIRONMENT.hemisphere.skyColor);
    hemisphereLight.groundColor.setHex(SURFACE_ENVIRONMENT.hemisphere.groundColor);
    hemisphereLight.intensity = SURFACE_ENVIRONMENT.hemisphere.intensity;
  }
  if (sunLight){
    sunLight.color.setHex(SURFACE_ENVIRONMENT.sun.color);
    sunLight.intensity = SURFACE_ENVIRONMENT.sun.intensity;
    const [sx, sy, sz] = SURFACE_ENVIRONMENT.sun.position;
    sunLight.position.set(sx, sy, sz);
  }
  if (typeof document !== 'undefined' && document.body){
    document.body.style.background = SURFACE_BODY_BACKGROUND;
  }
  if (camera){
    camera.far = SURFACE_CAMERA_FAR;
    camera.updateProjectionMatrix();
  }
}

function applySpaceEnvironment(){
  if (!scene) return;
  scene.background = new THREE.Color(SPACE_ENVIRONMENT.background);
  if (!scene.fog){
    scene.fog = new THREE.Fog(SPACE_ENVIRONMENT.fog.color, SPACE_ENVIRONMENT.fog.near, SPACE_ENVIRONMENT.fog.far);
  } else {
    scene.fog.color.setHex(SPACE_ENVIRONMENT.fog.color);
    scene.fog.near = SPACE_ENVIRONMENT.fog.near;
    scene.fog.far = SPACE_ENVIRONMENT.fog.far;
  }
  if (hemisphereLight){
    hemisphereLight.color.setHex(SPACE_ENVIRONMENT.hemisphere.skyColor);
    hemisphereLight.groundColor.setHex(SPACE_ENVIRONMENT.hemisphere.groundColor);
    hemisphereLight.intensity = SPACE_ENVIRONMENT.hemisphere.intensity;
  }
  if (sunLight){
    sunLight.color.setHex(SPACE_ENVIRONMENT.sun.color);
    sunLight.intensity = SPACE_ENVIRONMENT.sun.intensity;
    const [sx, sy, sz] = SPACE_ENVIRONMENT.sun.position;
    sunLight.position.set(sx, sy, sz);
  }
  if (typeof document !== 'undefined' && document.body){
    document.body.style.background = SPACE_BODY_BACKGROUND;
  }
  if (camera){
    camera.far = SPACE_CAMERA_FAR;
    camera.updateProjectionMatrix();
  }
}

function enterSpaceMode(){
  if (spaceModeActive || !scene) return;
  spaceModeActive = true;
  applySpaceEnvironment();
  setPlaneMeshesVisible(false);
  pendingSurfaceRebuildOptions = { mapId: currentMapId, force: true };
  replaceWorldManager(null);
  updateMapStatus({ label: 'Solar System', note: '(orbit)' });
  const solarWorld = ensureSolarSystemWorld();
  solarWorld?.enterSystemView({ planetId: 'earth' });
  updateHudStatus();
}

function exitSpaceMode(){
  if (!spaceModeActive) return;
  spaceModeActive = false;
  if (solarSystemWorld){
    solarSystemWorld.exitSystemView();
  }
  setPlaneMeshesVisible(true);
  applySurfaceEnvironment();
  const rebuildOptions = pendingSurfaceRebuildOptions || { mapId: currentMapId, force: true };
  pendingSurfaceRebuildOptions = null;
  updateMapStatus({ label: 'Planet surface', note: '(restoring…)' });
  rebuildWorldForCurrentMap(rebuildOptions);
  updateHudStatus();
}

function updateSpaceTransitionState({ altitude = 0, planeId = null } = {}){
  const followId = getCurrentFollowId();
  if (planeId && planeId !== followId) return;
  const altitudeMeters = Math.max(0, Number(altitude) || 0);
  if (spaceModeActive){
    if (altitudeMeters <= SPACE_EXIT_ALTITUDE_METERS){
      exitSpaceMode();
    }
  } else if (altitudeMeters >= SPACE_ENTRY_ALTITUDE_METERS){
    enterSpaceMode();
  }
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
  camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, SURFACE_CAMERA_FAR);
  renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  chaseCam = new ChaseCam(camera);

  worldOriginOffset = new THREE.Vector3(0, 0, 0);

  window.addEventListener('resize', onWindowResize);

  // Layered light rig: hemisphere for ambient mood and a sun-style directional light.
  hemisphereLight = new THREE.HemisphereLight(0xe4f1ff, 0x3a5d2f, 0.8);
  hemisphereLight.position.set(0, 200, 0);
  scene.add(hemisphereLight);

  sunLight = new THREE.DirectionalLight(0xffffff, 0.85);
  sunLight.position.set(-180, 220, 260);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -400;
  sunLight.shadow.camera.right = 400;
  sunLight.shadow.camera.top = 400;
  sunLight.shadow.camera.bottom = -400;
  sunLight.shadow.camera.far = 1200;
  scene.add(sunLight);

  applySurfaceEnvironment();

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
  if (chaseCam && !spaceModeActive) chaseCam.update(delta);
  if (solarSystemWorld){
    solarSystemWorld.update(delta);
  }
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
  if (spaceModeActive) return;
  if (chaseCam){
    chaseCam.follow(mesh);
    chaseCam.snapToTarget();
  } else if (camera){
    // If the chase camera has not been initialized yet, approximate the new baseline
    // offsets (50 back, 10 up) so the manual view matches the default follow distance.
    camera.position.set(mesh.position.x - 50, mesh.position.y, mesh.position.z + 10);
    camera.lookAt(mesh.position);
  }
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
    setManualMovementActive(false);
    throttleHoldEngaged = false;
    inputSetThrottleHold(false);
    resetManualFlightState();
    lastKnownManualVelocity = [0, 0, 0];
    emitManualOverrideSnapshot({ force: true, enabledOverride: false });
  } else {
    initializeManualFlightState();
    emitManualOverrideSnapshot({ force: true, enabledOverride: true });
  }

  updateManualButtonState();
  updateHudStatus();
}

function setInvertAxesEnabled(enabled){
  const shouldEnable = Boolean(enabled);
  if (invertAxesEnabled === shouldEnable) return;
  invertAxesEnabled = shouldEnable;
  inputSetInvertAxes(shouldEnable);
  persistInvertAxesPreference(shouldEnable);
  updateInvertAxesButtonState();
  updateHudStatus();
  renderControlDocs(currentControlDocs);
}

function setAccelerationEngaged(enabled, options = {}){
  const shouldEnable = Boolean(enabled);
  if (throttleHoldEngaged === shouldEnable) return;

  if (shouldEnable && !manualControlEnabled && !options.skipManualEnforce){
    setManualControlEnabled(true);
    if (!manualControlEnabled) return;
  }

  throttleHoldEngaged = shouldEnable;
  inputSetThrottleHold(throttleHoldEngaged);

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
    setAccelerationEngaged(!throttleHoldEngaged);
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

  const result = registerControlKeyDown(code);
  if (result.handled){
    if (result.preventDefault) event.preventDefault();
    return;
  }
}

function handleKeyUp(event){
  const { code } = event;
  const result = registerControlKeyUp(code);
  if (result.handled && result.preventDefault){
    event.preventDefault();
  }
}

function setManualMovementActive(active){
  if (manualMovementActive === active) return;
  manualMovementActive = active;
  updateHudStatus();
}

function initializeManualFlightState(){
  const followId = getCurrentFollowId();
  manualFlightFollowId = followId || null;
  const mesh = followId ? planeMeshes.get(followId) : null;
  if (!mesh){
    resetManualFlightState();
    return;
  }
  manualFlightState = {
    position: mesh.position.clone(),
    velocity: new THREE.Vector3(0, 0, 0),
    roll: mesh.rotation.x || 0,
    pitch: mesh.rotation.y || 0,
    yaw: mesh.rotation.z || 0,
    throttle: throttleHoldEngaged ? 1 : 0,
  };
  manualAirspeed = 0;
  lastKnownManualOrientation = [
    manualFlightState.yaw,
    manualFlightState.pitch,
    manualFlightState.roll,
  ];
}

function resetManualFlightState(){
  manualFlightState = null;
  manualFlightFollowId = null;
  manualAirspeed = 0;
}

function updateManualControl(delta){
  if (!manualControlEnabled) return;
  const followId = getCurrentFollowId();
  const mesh = planeMeshes.get(followId);
  if (!mesh){
    resetManualFlightState();
    return;
  }

  if (!manualFlightState || manualFlightFollowId !== followId){
    initializeManualFlightState();
  }
  manualFlightFollowId = followId;
  const state = manualFlightState;
  if (!state) return;

  const dt = Number.isFinite(delta) ? Math.max(delta, 0) : 0;
  const controls = readControls();

  const throttleTarget = clamp(controls.throttle, 0, 1);
  const throttleBlend = 1 - Math.exp(-THROTTLE_RESPONSE_RATE * dt);
  if (!Number.isFinite(state.throttle)) state.throttle = 0;
  state.throttle += (throttleTarget - state.throttle) * throttleBlend;
  state.throttle = clamp(state.throttle, 0, 1);

  state.yaw += clamp(controls.yaw, -1, 1) * MAX_YAW_RATE * dt;
  state.pitch = clamp(
    state.pitch + clamp(controls.pitch, -1, 1) * MAX_PITCH_RATE * dt,
    -MAX_PITCH,
    MAX_PITCH,
  );
  state.roll = clamp(
    state.roll + clamp(controls.roll, -1, 1) * MAX_ROLL_RATE * dt,
    -MAX_ROLL,
    MAX_ROLL,
  );

  TMP_EULER.set(state.roll, state.pitch, state.yaw, 'ZYX');
  mesh.setRotationFromEuler(TMP_EULER);

  TMP_QUAT.setFromEuler(TMP_EULER);
  TMP_FORWARD.set(0, 1, 0).applyQuaternion(TMP_QUAT);
  TMP_ACCEL.copy(TMP_FORWARD).multiplyScalar(THRUST_FORCE * state.throttle);
  state.velocity.addScaledVector(TMP_ACCEL, dt);

  const dragFactor = Math.max(0, 1 - (DRAG_COEFFICIENT * dt));
  state.velocity.multiplyScalar(dragFactor);
  if (state.velocity.length() > MAX_AIRSPEED){
    state.velocity.setLength(MAX_AIRSPEED);
  }

  manualAirspeed = state.velocity.length();
  TMP_VECTOR.copy(state.velocity).multiplyScalar(dt);
  state.position.add(TMP_VECTOR);
  state.position.z = clamp(state.position.z, MIN_ALTITUDE, MAX_ALTITUDE);
  mesh.position.copy(state.position);

  const movementActive =
    manualAirspeed > 0.1 ||
    Math.abs(controls.yaw) > 0.01 ||
    Math.abs(controls.pitch) > 0.01 ||
    Math.abs(controls.roll) > 0.01 ||
    state.throttle > 0.01;
  setManualMovementActive(movementActive);

  const orientation = [state.yaw, state.pitch, state.roll];
  lastKnownManualOrientation = orientation;
  const velocitySim = sceneVelocityToSim(state.velocity);
  lastKnownManualVelocity = velocitySim;

  maybeSendManualOverride({
    enabled: manualControlEnabled,
    velocity: velocitySim,
    orientation,
  });

  updateHudStatus();
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
  const throttleValue = manualFlightState?.throttle;
  const throttlePercent = Math.round(clamp(
    Number.isFinite(throttleValue) ? throttleValue : (throttleHoldEngaged ? 1 : 0),
    0,
    1,
  ) * 100);
  const throttleLabel = `Throttle: ${throttlePercent}%${throttleHoldEngaged ? ' (hold)' : ''}`;
  const airspeedLabel = `Airspeed: ${manualAirspeed.toFixed(0)} u/s`;
  const altitudeLabel = `Altitude: ${(currentFollowAltitude / 1000).toFixed(1)} km`;
  const spaceStatusLabel = spaceModeActive ? 'Space mode: Solar system view active' : 'Space mode: Planet surface';
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
    ? '↑/↓ pitch, ←/→ roll (inverted)'
    : '↑/↓ pitch, ←/→ roll';

  HUD.innerText =
    `${connectionStatus}\n` +
    `Mode: ${controlMode}\n` +
    `Model set: ${modelLine}\n` +
    `${throttleLabel}\n` +
    `${airspeedLabel}\n` +
    `${altitudeLabel}\n` +
    `${spaceStatusLabel}\n` +
    `${simOverrideLabel}\n` +
    `${invertStatusLabel}\n` +
    `[M] toggle manual · [T] throttle hold · W/S pitch · A/D roll · Q/E yaw · ${arrowInstructions}`;

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
      setAccelerationEngaged(!throttleHoldEngaged);
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

function setupMatchControls(){
  MATCH_PRESETS.forEach((preset) => {
    const button = MATCH_BUTTONS.get(preset.id);
    if (!button) return;
    button.textContent = preset.label;
    button.title = preset.description;
    button.addEventListener('click', () => {
      handleMatchSelection(preset.id);
    });
  });
  updateMatchUiState();
}

function handleMatchSelection(matchId){
  if (pendingAutopilotPreset){
    console.warn('Autopilot command already pending');
    return;
  }
  const preset = AUTOPILOT_PRESETS.find((entry) => entry.id === matchId);
  if (!preset){
    console.warn('Unknown match preset', matchId);
    return;
  }
  const commandId = sendSimCommand('set_waypoints', {
    waypoints: preset.waypoints,
    loop: preset.loop,
    arrival_tolerance: preset.arrivalTolerance,
  });
  if (commandId){
    const index = AUTOPILOT_PRESETS.findIndex((entry) => entry.id === preset.id);
    pendingAutopilotPreset = {
      commandId,
      label: preset.label,
      index: index >= 0 ? index : 0,
      matchId: preset.id,
    };
    updateRerouteButtonState();
  }
}

function updateMatchUiState(){
  const pendingMatchId = pendingAutopilotPreset?.matchId || null;
  const statusElement = MATCH_STATUS;
  if (statusElement){
    if (pendingMatchId){
      statusElement.textContent = `Assigning ${pendingAutopilotPreset.label}…`;
    } else if (activeMatchId){
      const preset = getMatchPresetById(activeMatchId);
      if (preset){
        statusElement.textContent = `${preset.label}: ${preset.description}`;
      } else {
        statusElement.textContent = 'Active match engaged.';
      }
    } else {
      statusElement.textContent = 'Select a match to update autopilot routing.';
    }
  }

  MATCH_PRESETS.forEach((preset) => {
    const button = MATCH_BUTTONS.get(preset.id);
    if (!button) return;
    const isActive = activeMatchId === preset.id;
    const isPending = pendingMatchId === preset.id;
    const shouldDisable = Boolean(pendingAutopilotPreset);
    button.disabled = shouldDisable;
    button.classList.toggle('is-active', isActive);
    button.classList.toggle('is-pending', isPending);
  });
}

function getMatchPresetById(matchId){
  return MATCH_PRESETS.find((preset) => preset.id === matchId) || null;
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
    if (manualControlEnabled){
      initializeManualFlightState();
    } else {
      resetManualFlightState();
    }
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
  const label = throttleHoldEngaged ? 'Release Throttle Hold' : 'Hold Max Throttle';
  ACCELERATE_BUTTON.textContent = label;
  ACCELERATE_BUTTON.classList.toggle('is-active', throttleHoldEngaged);
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
    generator: entry.generator || entry.integration,
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
  if (spaceModeActive){
    pendingSurfaceRebuildOptions = { mapId, force: true };
    const entryWhileInSpace = availableMaps.get(mapId) || availableMaps.get(DEFAULT_MAP_ID);
    if (entryWhileInSpace){
      updateMapStatus({ label: entryWhileInSpace.label || mapId, note: '(available after re-entry)' });
    }
    return;
  }
  const entry = availableMaps.get(mapId) || availableMaps.get(DEFAULT_MAP_ID);
  if (entry){
    updateMapStatus({ label: entry.label, note: '(loading…)' });
  }

  const token = ++mapBuildToken;

  try {
    const descriptor = await ensureMapDescriptor(mapId);
    if (spaceModeActive){
      pendingSurfaceRebuildOptions = { mapId, force: true };
      return;
    }
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
    const url = buildMapManifestUrl(entry.path);
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok){
      throw new Error(`Failed to load map descriptor ${mapId}: HTTP ${response.status}`);
    }
    const descriptor = await response.json();
    const normalized = normalizeMapDescriptor(descriptor, { ...entry, assetRoot: entry.assetRoot || deriveAssetRootFromUrl(url) });
    mapDescriptorCache.set(mapId, normalized);
    return normalized;
  }

  const normalized = normalizeMapDescriptor(entry, entry);
  mapDescriptorCache.set(mapId, normalized);
  return normalized;
}

function createWorldManagerFromDescriptor(descriptor){
  if (!descriptor || !scene) return null;
  if (descriptor.type === 'tilemap'){
    return createTileMapWorld({ scene, descriptor });
  }
  if (descriptor.id === 'procedural:endless' || descriptor.generator === 'sandbox'){
    try {
      return createSandboxWorld({ scene, descriptor });
    } catch (err) {
      console.warn('Falling back to legacy endless world after sandbox integration error', err);
    }
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
    tiles.set(key, prepareTileDefinition({ tile, coords: { x: coords[0], y: coords[1] }, chunkSize, assetRoot: descriptor.assetRoot }));
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
      const { group, disposables = [], pendingReady = [], obstacles: initialObstacles = [] } = buildTileChunk({
        descriptor,
        tile,
        chunkSize,
        assetRoot: tile.assetRoot || descriptor.assetRoot,
      });
      group.name = `Tile_${x}_${y}`;
      positionChunk({ coords, group });
      const chunkEntry = {
        coords,
        group,
        disposables: Array.isArray(disposables) ? [...disposables] : [],
        obstacles: Array.isArray(initialObstacles) ? [...initialObstacles] : [],
        pending: [],
        disposed: false,
      };

      if (Array.isArray(pendingReady)){
        pendingReady.forEach((promise) => {
          if (!promise || typeof promise.then !== 'function') return;
          const tracked = promise.then((readyState) => {
            if (!readyState) return;
            const resources = Array.isArray(readyState.disposables) ? readyState.disposables : [];
            if (chunkEntry.disposed){
              resources.forEach((resource) => resource?.dispose?.());
              if (readyState.root?.parent){
                readyState.root.parent.remove(readyState.root);
              }
              return;
            }
            resources.forEach((resource) => {
              if (resource) chunkEntry.disposables.push(resource);
            });
            if (readyState.collidable && readyState.loaded && readyState.root){
              const records = collectMeshObstacles({
                root: readyState.root,
                chunkWorldOrigin: readyState.chunkWorldOrigin || { x: coords.x * chunkSize, y: coords.y * chunkSize },
                type: readyState.collision?.type || readyState.type,
                collision: readyState.collision,
              });
              if (records?.length){
                chunkEntry.obstacles.push(...records);
              }
            }
          }).catch((err) => {
            console.warn('Failed to finalize tile map object', err);
          });
          chunkEntry.pending.push(tracked);
        });
      }

      return chunkEntry;
    }

    if (fallbackType === 'procedural'){
      const rng = createSeededRng(fallbackSeed, x, y);
      const { group, disposables } = buildChunkContents({ coords, chunkSize, rng });
      group.name = `TileFallback_${x}_${y}`;
      positionChunk({ coords, group });
      return { coords, group, disposables, obstacles: [], pending: [], disposed: false };
    }

    const group = new THREE.Group();
    group.name = `TileEmpty_${x}_${y}`;
    positionChunk({ coords, group });
    return { coords, group, disposables: [], obstacles: [], pending: [], disposed: false };
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

  function getHeightAt(x, y){
    const originOffset = ensureWorldOriginOffset();
    const globalX = x + originOffset.x;
    const globalY = y + originOffset.y;
    const chunkX = Math.floor(globalX / chunkSize);
    const chunkY = Math.floor(globalY / chunkSize);
    const tile = tiles.get(chunkKey(chunkX, chunkY));
    const chunkOriginX = chunkX * chunkSize;
    const chunkOriginY = chunkY * chunkSize;
    const localX = globalX - chunkOriginX;
    const localY = globalY - chunkOriginY;
    if (tile?.heightSampler){
      return tile.heightSampler(localX, localY);
    }
    if (tile){
      return Number(tile.baseHeight || 0) || 0;
    }
    if (fallbackType === 'procedural'){
      return getTerrainHeight(globalX, globalY);
    }
    return 0;
  }

  function getOriginOffset(){
    return ensureWorldOriginOffset().clone();
  }

  function getObstaclesNear(x, y, radius = chunkSize){
    const originOffset = ensureWorldOriginOffset();
    const globalX = x + originOffset.x;
    const globalY = y + originOffset.y;
    const chunkX = Math.floor(globalX / chunkSize);
    const chunkY = Math.floor(globalY / chunkSize);
    const results = [];
    for (let dx = -1; dx <= 1; dx += 1){
      for (let dy = -1; dy <= 1; dy += 1){
        const entry = chunkMap.get(chunkKey(chunkX + dx, chunkY + dy));
        if (!entry?.obstacles?.length) continue;
        entry.obstacles.forEach((obstacle) => {
          if (!obstacle?.worldPosition) return;
          const dxWorld = obstacle.worldPosition.x - globalX;
          const dyWorld = obstacle.worldPosition.y - globalY;
          const combined = radius + (obstacle.radius ?? 0);
          if (dxWorld * dxWorld + dyWorld * dyWorld <= combined * combined){
            results.push(obstacle);
          }
        });
      }
    }
    return results;
  }

  function disposeChunk(chunkEntry){
    if (!chunkEntry) return;
    chunkEntry.disposed = true;
    if (Array.isArray(chunkEntry.pending)){
      chunkEntry.pending.length = 0;
    }
    if (Array.isArray(chunkEntry.obstacles)){
      chunkEntry.obstacles.length = 0;
    }
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

  return { update, handleOriginShift, dispose: disposeAll, getHeightAt, getOriginOffset, getObstaclesNear };
}

function buildTileChunk({ descriptor, tile, chunkSize, assetRoot }){
  const group = new THREE.Group();
  const disposables = [];
  const pendingReady = [];
  const chunkWorldOrigin = {
    x: (tile?.coords?.x ?? 0) * chunkSize,
    y: (tile?.coords?.y ?? 0) * chunkSize,
  };

  const baseColor = resolveColor(tile.groundColor || descriptor.groundColor, '#6a8b5d');
  const elevation = Number(tile.baseHeight ?? tile.elevation ?? 0) || 0;

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
      const created = createMapObject({
        descriptor: objectDescriptor,
        chunkSize,
        seed: `${descriptor.id || 'map'}:${tile.coords?.x}:${tile.coords?.y}:${index}`,
        assetRoot: objectDescriptor.assetRoot || tile.assetRoot || assetRoot,
      });
      if (created){
        group.add(created.object);
        if (Array.isArray(created.disposables)){
          created.disposables.forEach((resource) => {
            if (resource) disposables.push(resource);
          });
        }
        const collisionSettings = objectDescriptor?.collision || {};
        const type = created.type;
        const collidable = collisionSettings.enabled !== false
          && (type === 'glb' || type === 'gltf' || collisionSettings.enabled === true);
        if (created.ready && typeof created.ready.then === 'function'){
          pendingReady.push(created.ready.then((readyState) => ({
            root: readyState?.root ?? created.object,
            loaded: readyState?.loaded !== false,
            disposables: Array.isArray(readyState?.disposables) ? readyState.disposables.filter(Boolean) : [],
            collidable,
            collision: collisionSettings,
            type,
            chunkWorldOrigin,
          })));
        } else {
          pendingReady.push(Promise.resolve({
            root: created.object,
            loaded: true,
            disposables: [],
            collidable,
            collision: collisionSettings,
            type,
            chunkWorldOrigin,
          }));
        }
      }
    });
  }

  return { group, disposables, pendingReady, obstacles: [] };
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

function prepareTileDefinition({ tile, coords, chunkSize, assetRoot }){
  const prepared = { ...(tile || {}) };
  prepared.coords = coords || { x: 0, y: 0 };
  const baseHeight = Number(tile?.baseHeight ?? tile?.elevation ?? 0) || 0;
  prepared.baseHeight = baseHeight;
  const effectiveRoot = normalizeAssetRootPath(tile?.assetRoot || assetRoot || '');
  if (effectiveRoot){
    prepared.assetRoot = effectiveRoot;
  }
  if (typeof tile?.heightSampler === 'function'){
    prepared.heightSampler = tile.heightSampler;
  } else {
    prepared.heightSampler = createTileHeightSampler(tile, chunkSize, baseHeight);
  }
  return prepared;
}

function createTileHeightSampler(tile, chunkSize, baseHeight = 0){
  const descriptor = tile?.heightfield;
  if (!descriptor || !Array.isArray(descriptor.data)){
    return () => baseHeight;
  }
  const rows = Number(descriptor.rows) || Number(descriptor.height);
  const cols = Number(descriptor.cols) || Number(descriptor.width);
  if (!rows || !cols || descriptor.data.length !== rows * cols){
    return () => baseHeight;
  }
  const scale = descriptor.scale || descriptor.metersPerSample || {};
  const scaleZ = typeof scale === 'number'
    ? scale
    : Number(scale.z ?? scale[2] ?? descriptor.scaleZ ?? descriptor.heightScale ?? 1) || 1;

  return (localX, localY) => {
    if (rows === 1 && cols === 1){
      return baseHeight + Number(descriptor.data[0] || 0) * scaleZ;
    }
    const u = Math.max(0, Math.min(0.999999, (localX / chunkSize) + 0.5));
    const v = Math.max(0, Math.min(0.999999, (localY / chunkSize) + 0.5));
    const col = u * (cols - 1);
    const row = v * (rows - 1);
    const c0 = Math.floor(col);
    const c1 = Math.min(cols - 1, c0 + 1);
    const r0 = Math.floor(row);
    const r1 = Math.min(rows - 1, r0 + 1);
    const tx = col - c0;
    const ty = row - r0;
    const index = (r, c) => Number(descriptor.data[r * cols + c]) || 0;
    const h00 = index(r0, c0);
    const h01 = index(r0, c1);
    const h10 = index(r1, c0);
    const h11 = index(r1, c1);
    const h0 = h00 * (1 - tx) + h01 * tx;
    const h1 = h10 * (1 - tx) + h11 * tx;
    return baseHeight + ((h0 * (1 - ty) + h1 * ty) * scaleZ);
  };
}

function createMapObject({ descriptor, chunkSize, seed, assetRoot }){
  if (!descriptor) return null;
  const typeValue = descriptor.type || descriptor.kind || 'box';
  const type = typeof typeValue === 'string' ? typeValue.toLowerCase() : typeValue;
  const disposables = [];
  let innerObject = null;
  let readyPromise = null;

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
    innerObject = mesh;
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
    innerObject = mesh;
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
    innerObject = mesh;
    disposables.push(geometry, material);
  } else if (type === 'tree' || type === 'preset:tree'){
    const rng = createSeededRng(seed || 'tree', descriptor.position?.[0] || 0, descriptor.position?.[1] || 0);
    const tree = createProceduralTree({ rng, position: { x: 0, y: 0 } });
    innerObject = tree.object;
    innerObject.position.set(0, 0, 0);
    if (Array.isArray(tree.disposables)){
      tree.disposables.forEach((resource) => disposables.push(resource));
    }
  } else if (type === 'gltf' || type === 'glb'){
    const placeholder = new THREE.Group();
    placeholder.name = descriptor.name || descriptor.label || 'GLTFObject';
    const source = descriptor.url || descriptor.path || descriptor.src || descriptor.file;
    const effectiveRoot = descriptor.assetRoot || assetRoot;
    if (!source){
      console.warn('Map object missing glTF path', descriptor);
      readyPromise = Promise.resolve({ root: placeholder, loaded: false, disposables: [] });
    } else {
      readyPromise = loadGLTFAsset(source, { assetRoot: effectiveRoot }).then((gltf) => {
        if (!gltf || !gltf.scene){
          return { root: placeholder, loaded: false, disposables: [] };
        }
        const scene = gltf.scene;
        placeholder.add(scene);
        const resources = [];
        scene.traverse((node) => {
          if (!node?.isMesh) return;
          node.castShadow = descriptor.castShadow !== false;
          node.receiveShadow = descriptor.receiveShadow !== false;
          if (descriptor.frustumCulled === false){
            node.frustumCulled = false;
          }
          if (node.geometry){
            const clonedGeometry = node.geometry.clone();
            node.geometry = clonedGeometry;
            resources.push(clonedGeometry);
          }
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          const clonedMaterials = materials.map((material) => {
            if (!material) return material;
            const clone = material.clone();
            const override = pickMaterialOverride({ overrides: descriptor.materialOverrides, mesh: node, material })
              || descriptor.material;
            applyMaterialOptions(clone, override);
            gatherMaterialTextures(clone).forEach((texture) => {
              if (texture) resources.push(texture);
            });
            resources.push(clone);
            return clone;
          });
          if (Array.isArray(node.material)){
            node.material = clonedMaterials;
          } else if (clonedMaterials.length){
            node.material = clonedMaterials[0];
          }
        });
        return { root: placeholder, loaded: true, disposables: resources };
      }).catch((err) => {
        console.warn('Failed to load glTF asset', source, err);
        return { root: placeholder, loaded: false, disposables: [] };
      });
    }
    innerObject = placeholder;
  }

  if (!innerObject) return null;

  const holder = new THREE.Group();
  holder.name = descriptor.name || `MapObject_${type}`;
  holder.userData = holder.userData || {};
  holder.userData.mapObjectType = type;
  if (descriptor.visible === false){
    holder.visible = false;
  }
  holder.add(innerObject);
  applyTransform(holder, descriptor.transform || descriptor);

  if (readyPromise){
    readyPromise = readyPromise.then((result) => ({ ...(result || {}), root: holder }));
  }

  const ready = readyPromise
    ? readyPromise.then((result) => normalizeLoadedObjectResult(result, holder))
    : Promise.resolve({ root: holder, loaded: true, disposables: [] });

  return { object: holder, disposables, ready, type };
}

function normalizeLoadedObjectResult(result, fallbackRoot){
  const root = result?.root ?? fallbackRoot;
  const loaded = result?.loaded !== false;
  const disposables = Array.isArray(result?.disposables)
    ? result.disposables.filter(Boolean)
    : [];
  return { root, loaded, disposables };
}

function pickMaterialOverride({ overrides, mesh, material } = {}){
  if (!overrides) return null;

  const sanitize = (override) => {
    if (!override || typeof override !== 'object') return override;
    const { target, name, mesh: meshName, material: matName, ...rest } = override;
    if (override.override && typeof override.override === 'object'){
      return sanitize(override.override);
    }
    if (Object.keys(rest).length === 0) return null;
    return rest;
  };

  if (Array.isArray(overrides)){
    for (const entry of overrides){
      if (!entry) continue;
      const target = entry.target || entry.name || entry.mesh || entry.material;
      if (!target) continue;
      if ((mesh?.name && mesh.name === target) || (material?.name && material.name === target)){
        return sanitize(entry);
      }
    }
    const fallback = overrides.find((entry) => entry?.default);
    return fallback ? sanitize(fallback.default || fallback) : null;
  }

  if (mesh?.name && overrides[mesh.name]){
    return sanitize(overrides[mesh.name]);
  }
  if (material?.name && overrides[material.name]){
    return sanitize(overrides[material.name]);
  }
  if (overrides.default){
    return sanitize(overrides.default);
  }
  return null;
}

function applyMaterialOptions(material, override){
  if (!material || !override) return;
  if (override.color !== undefined && material.color){
    material.color.set(new THREE.Color(resolveColor(override.color, material.color.getHexString?.() ? `#${material.color.getHexString()}` : '#ffffff')));
  }
  if (override.emissive !== undefined && material.emissive){
    material.emissive.set(new THREE.Color(resolveColor(override.emissive, material.emissive.getHexString?.() ? `#${material.emissive.getHexString()}` : '#000000')));
  }
  if (override.emissiveIntensity !== undefined && material.emissiveIntensity !== undefined){
    material.emissiveIntensity = Number(override.emissiveIntensity);
  }
  if (override.metalness !== undefined && material.metalness !== undefined){
    material.metalness = Number(override.metalness);
  }
  if (override.roughness !== undefined && material.roughness !== undefined){
    material.roughness = Number(override.roughness);
  }
  if (override.opacity !== undefined && material.opacity !== undefined){
    material.opacity = Number(override.opacity);
  }
  if (override.transparent !== undefined){
    material.transparent = Boolean(override.transparent);
  }
  if (override.side !== undefined && material.side !== undefined){
    material.side = override.side;
  }
  material.needsUpdate = true;
}

const MATERIAL_TEXTURE_KEYS = [
  'map', 'normalMap', 'metalnessMap', 'roughnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap',
  'displacementMap', 'lightMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap',
  'sheenColorMap', 'sheenRoughnessMap', 'transmissionMap', 'thicknessMap', 'specularMap', 'specularColorMap',
];

function gatherMaterialTextures(material){
  const textures = [];
  MATERIAL_TEXTURE_KEYS.forEach((key) => {
    const value = material[key];
    if (value && typeof value.dispose === 'function'){
      textures.push(value);
    }
  });
  return textures;
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

const TMP_OBSTACLE_BOX = new THREE.Box3();
const TMP_OBSTACLE_SIZE = new THREE.Vector3();
const TMP_OBSTACLE_CENTER = new THREE.Vector3();

function collectMeshObstacles({ root, chunkWorldOrigin, type, collision } = {}){
  if (!root) return [];
  const originX = chunkWorldOrigin?.x ?? 0;
  const originY = chunkWorldOrigin?.y ?? 0;
  const obstacles = [];
  root.updateWorldMatrix(true, true);
  root.traverse((node) => {
    if (!node?.isMesh) return;
    TMP_OBSTACLE_BOX.setFromObject(node);
    if (!Number.isFinite(TMP_OBSTACLE_BOX.min.x) || !Number.isFinite(TMP_OBSTACLE_BOX.max.x)) return;
    TMP_OBSTACLE_BOX.getSize(TMP_OBSTACLE_SIZE);
    TMP_OBSTACLE_BOX.getCenter(TMP_OBSTACLE_CENTER);
    let radius = Math.max(TMP_OBSTACLE_SIZE.x, TMP_OBSTACLE_SIZE.y) * 0.5;
    if (collision?.radius != null){
      const specified = Number(collision.radius);
      if (Number.isFinite(specified)){
        radius = specified;
      }
    }
    const worldPosition = new THREE.Vector3(
      originX + TMP_OBSTACLE_CENTER.x,
      originY + TMP_OBSTACLE_CENTER.y,
      TMP_OBSTACLE_CENTER.z,
    );
    if (Array.isArray(collision?.offset)){
      worldPosition.x += Number(collision.offset[0]) || 0;
      worldPosition.y += Number(collision.offset[1]) || 0;
      worldPosition.z += Number(collision.offset[2]) || 0;
    }
    const topHeight = collision?.topHeight != null
      ? Number(collision.topHeight)
      : TMP_OBSTACLE_BOX.max.z;
    const baseHeight = collision?.baseHeight != null
      ? Number(collision.baseHeight)
      : TMP_OBSTACLE_BOX.min.z;
    obstacles.push({
      mesh: node,
      meshId: node.uuid,
      radius: Math.max(0, radius),
      worldPosition,
      topHeight,
      baseHeight,
      type: collision?.type || type || 'generic',
      bounds: {
        min: TMP_OBSTACLE_BOX.min.clone(),
        max: TMP_OBSTACLE_BOX.max.clone(),
        size: TMP_OBSTACLE_SIZE.clone(),
      },
    });
  });
  return obstacles;
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

