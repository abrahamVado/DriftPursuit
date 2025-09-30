/**
 * Cloud of Orbs bootstrap sequence.
 *
 * To run alongside the Terra sandbox:
 * 1. Start the local viewer dev server (e.g. `npm run viewer` or `python -m http.server` from the repo root).
 * 2. Open `viewer/cloud-of-orbs/index.html` in a modern browser.
 * 3. Ensure `three.min.js` is served globally (handled via the CDN script tag in `index.html`).
 *
 * This file mirrors Terra's initialization flow while orchestrating the orbital view and
 * the surface transition manager.
 */

import { createRenderer, createPerspectiveCamera, enableWindowResizeHandling, requireTHREE } from '../shared/threeSetup.js';
import { TerraHUD } from '../terra/TerraHUD.js';
import { TerraProjectileManager } from '../terra/Projectiles.js';
import { DEFAULT_WORLD_ENVIRONMENT } from '../terra/worldFactory.js';
import { PLANETS_IN_RENDER_ORDER, getRegistrySnapshot } from './planets/index.js';
import { createHud, createHudPresets } from './hudConfig.js';
import { SolarSystemWorld } from './SolarSystemWorld.js';
import { PlanetSurfaceManager, PlanetSurfaceState } from './PlanetSurfaceManager.js';
import { CloudOfOrbsInputManager } from './InputManager.js';
import { MatchManager } from './MatchManager.js';

const THREE = requireTHREE();

const ESCAPE_ALTITUDE_THRESHOLD = 10000;
const ESCAPE_ALTITUDE_RESET = 7600;

const SPACE_ENVIRONMENT = Object.freeze({
  bodyBackground: 'radial-gradient(circle at 50% 20%, #071427 0%, #030912 55%, #010308 100%)',
  background: 0x050b16,
  fog: { color: 0x050b16, near: 12000, far: 36000 },
  sun: { color: 0xfff0d2, intensity: 2.15, position: [-5200, 4200, 2600] },
  hemisphere: { skyColor: 0x3a4c72, groundColor: 0x040608, intensity: 0.45 },
});

const DEFAULT_SURFACE_DESCRIPTOR = {
  id: 'aurora-basin',
  name: 'Aurora Basin',
  description: 'Rolling terrain under bright aurora skies.',
  type: 'procedural',
  seed: 982451653,
  chunkSize: 640,
  radius: 3,
  environment: {
    background: '#90b6ff',
    bodyBackground: DEFAULT_WORLD_ENVIRONMENT.bodyBackground,
    fog: {
      color: '#a4c6ff',
      near: DEFAULT_WORLD_ENVIRONMENT.fog.near,
      far: DEFAULT_WORLD_ENVIRONMENT.fog.far,
    },
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
};

const FIRE_COOLDOWN = 0.35;
const MIN_FAILED_FIRE_DELAY = 0.12;

const planetRegistry = getRegistrySnapshot();
const initialPlanetId = planetRegistry.has('earth')
  ? 'earth'
  : PLANETS_IN_RENDER_ORDER[0]?.metadata?.id
  ?? Array.from(planetRegistry.keys())[0]
  ?? null;

const planetOptions = PLANETS_IN_RENDER_ORDER.map((module) => ({
  id: module.metadata.id,
  name: module.metadata.label,
  description: module.metadata.description ?? '',
}));

const ammoManager = new TerraProjectileManager({ scene: null, world: null });
const ammoOptions = ammoManager.getAmmoTypes();

const input = new CloudOfOrbsInputManager();
input.setOrbitalControlsEnabled(true);

const MATCH_PRESETS = [
  {
    id: 'match-1',
    label: 'Match 1',
    description: 'Balanced runway loop with gentle turns and smooth altitude changes.',
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
    id: 'match-2',
    label: 'Match 2',
    description: 'Aggressive harbour climb threading coastal peaks before diving to the runway.',
    loop: true,
    arrivalTolerance: 70,
    waypoints: [
      [-600, -300, 1000],
      [-150, 260, 1500],
      [520, 520, 1400],
      [420, -280, 1050],
    ],
  },
  {
    id: 'match-3',
    label: 'Match 3',
    description: 'High ridge sprint weaving through mountain saddles before a steep valley drop.',
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
  {
    id: 'match-4',
    label: 'Match 4',
    description: 'Stratosphere dash slinging the craft toward thin air before lining up a long glide home.',
    loop: true,
    arrivalTolerance: 90,
    waypoints: [
      [-1000, -800, 1800],
      [-320, 240, 5200],
      [620, 640, 9200],
      [280, -320, 11800],
      [-420, -540, 5200],
    ],
  },
];

const hudPresets = createHudPresets();
const { hud } = createHud({
  TerraHUDClass: TerraHUD,
  ammoOptions,
  mapOptions: planetOptions,
  onAmmoSelect: handleAmmoSelection,
  onMapSelect: handlePlanetSelection,
  presets: hudPresets,
});

hud.setActiveAmmo(ammoManager.getCurrentAmmoId());
hud.setControls(hudPresets.system);

const renderer = createRenderer({ enableShadows: true });
document.body.style.margin = '0';
document.body.style.overflow = 'hidden';

const scene = new THREE.Scene();
scene.background = new THREE.Color(SPACE_ENVIRONMENT.background);
scene.fog = new THREE.Fog(SPACE_ENVIRONMENT.fog.color, SPACE_ENVIRONMENT.fog.near, SPACE_ENVIRONMENT.fog.far);

const camera = createPerspectiveCamera({ fov: 60, near: 0.1, far: 260000 });

const hemisphere = new THREE.HemisphereLight(0x3a4c72, 0x040608, 0.45);
scene.add(hemisphere);

const sunLight = new THREE.DirectionalLight(SPACE_ENVIRONMENT.sun.color, SPACE_ENVIRONMENT.sun.intensity);
sunLight.position.set(
  SPACE_ENVIRONMENT.sun.position[0],
  SPACE_ENVIRONMENT.sun.position[1],
  SPACE_ENVIRONMENT.sun.position[2],
);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(4096, 4096);
sunLight.shadow.camera.near = 100;
sunLight.shadow.camera.far = 32000;
sunLight.shadow.camera.left = -16000;
sunLight.shadow.camera.right = 16000;
sunLight.shadow.camera.top = 16000;
sunLight.shadow.camera.bottom = -16000;
scene.add(sunLight);

const ambient = new THREE.AmbientLight(0x0f1c34, 0.32);
scene.add(ambient);

applySpaceEnvironment();

const solarSystem = new SolarSystemWorld({
  scene,
  camera,
  planetRegistry,
  initialPlanetId,
});

const surfaceManager = new PlanetSurfaceManager({
  scene,
  camera,
  planetRegistry,
  orbitalCameraRig: solarSystem.getCameraRig(),
  hud,
  hudPresets,
  projectileManager: ammoManager,
  skyCeiling: 20000,
  environment: { document, hemisphere, sun: sunLight, defaults: DEFAULT_WORLD_ENVIRONMENT },
  onStateChange: handleSurfaceStateChange,
  onSurfaceReady: handleSurfaceReady,
  onSurfaceDisposed: handleSurfaceDisposed,
  defaultSurfaceDescriptor: DEFAULT_SURFACE_DESCRIPTOR,
});

const vehicleOpsQueue = [];
const activeFireSources = new Set();
let fireInputHeld = false;
let fireCooldownTimer = 0;
let elapsedTime = 0;
let lastFrameTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
let matchManager = null;
let escapeAltitudeArmed = false;
let lastProximityMetrics = null;

handlePlanetSelection(initialPlanetId);
hud.setActiveMap(initialPlanetId ?? '');
hud.setMapLabel('Orbital Overview');

ammoManager.setScene?.(scene);
ammoManager.setWorld?.(null);

matchManager = new MatchManager({ presets: MATCH_PRESETS, hud, surfaceManager });

enableWindowResizeHandling({ renderer, camera });
requestAnimationFrame(animate);

window.addEventListener('keydown', (event) => {
  if (event.defaultPrevented) return;
  const state = surfaceManager.getState();
  if (event.code === 'BracketRight'){
    enqueueVehicleOp((system) => system.cycleActiveVehicle?.(1));
    if (state === PlanetSurfaceState.SYSTEM_VIEW){
      solarSystem.cycleFocus(1);
      handlePlanetSelection(solarSystem.getFocusPlanetId());
    }
    event.preventDefault();
  } else if (event.code === 'BracketLeft'){
    enqueueVehicleOp((system) => system.cycleActiveVehicle?.(-1));
    if (state === PlanetSurfaceState.SYSTEM_VIEW){
      solarSystem.cycleFocus(-1);
      handlePlanetSelection(solarSystem.getFocusPlanetId());
    }
    event.preventDefault();
  } else if (event.code === 'KeyF'){
    enqueueVehicleOp((system) => system.handleFocusShortcut?.());
    event.preventDefault();
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
  if (event.button === 0 && surfaceManager.getState() !== PlanetSurfaceState.SYSTEM_VIEW){
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

window.DriftPursuitCloud = {
  join: (id, options) => enqueueVehicleOp((system) => system.handlePlayerJoin?.(id, options)),
  leave: (id) => enqueueVehicleOp((system) => system.handlePlayerLeave?.(id)),
  cycle: (delta = 1) => enqueueVehicleOp((system) => system.cycleActiveVehicle?.(delta)),
  focus: () => enqueueVehicleOp((system) => system.handleFocusShortcut?.()),
  setActive: (id) => enqueueVehicleOp((system) => system.setActiveVehicle?.(id)),
  update: (id, snapshot) => enqueueVehicleOp((system) => system.applyVehicleSnapshot?.(id, snapshot)),
  fire: () => surfaceManager.vehicleSystem?.fireActiveVehicleProjectile?.() ?? false,
  setAmmo: (ammoId) => {
    const accepted = ammoManager.setAmmoType(ammoId);
    if (accepted){
      hud.setActiveAmmo(ammoManager.getCurrentAmmoId());
    }
    return accepted;
  },
  getTrackedVehicles(){
    return surfaceManager.vehicleSystem?.getTrackedVehicles?.() ?? [];
  },
  selectPlanet: (planetId) => handlePlanetSelection(planetId),
  getState: () => surfaceManager.getState(),
};

function animate(now){
  requestAnimationFrame(animate);
  const dt = Math.min(0.08, ((now ?? performance.now()) - lastFrameTime) / 1000 || 0);
  lastFrameTime = now;
  elapsedTime += dt;

  const inputSample = input.readState(dt);

  const matchControl = matchManager?.update(dt, {
    surfaceState: surfaceManager.getState(),
    vehicleSystem: surfaceManager.vehicleSystem,
  });

  if (matchControl){
    if (matchControl.modeRequest && !inputSample.modeRequest){
      inputSample.modeRequest = matchControl.modeRequest;
    }
    if (matchControl.plane){
      inputSample.plane = matchControl.plane;
    }
  }

  if (inputSample.system?.cycle && surfaceManager.getState() === PlanetSurfaceState.SYSTEM_VIEW){
    solarSystem.cycleFocus(inputSample.system.cycle);
    handlePlanetSelection(solarSystem.getFocusPlanetId());
  }

  const proximityMetrics = solarSystem.update(dt, { inputSample });
  lastProximityMetrics = proximityMetrics;
  const exitRequested = Boolean(inputSample.system?.exitPlanet);

  if (exitRequested && surfaceManager.getState() !== PlanetSurfaceState.SYSTEM_VIEW){
    surfaceManager.requestSystemView({ reason: 'manual' });
  }

  surfaceManager.update({
    dt,
    elapsedTime,
    inputSample,
    orbitInput: inputSample.cameraOrbit,
    proximityMetrics,
  });

  monitorEscapeAltitude();

  flushVehicleQueue();

  fireCooldownTimer = Math.max(0, fireCooldownTimer - dt);
  if (fireInputHeld && fireCooldownTimer <= 0){
    const fired = surfaceManager.vehicleSystem?.fireActiveVehicleProjectile?.() ?? false;
    fireCooldownTimer = fired ? FIRE_COOLDOWN : MIN_FAILED_FIRE_DELAY;
  }

  if (surfaceManager.getState() === PlanetSurfaceState.SYSTEM_VIEW){
    const altitude = proximityMetrics?.altitude ?? 0;
    const vehicleMap = surfaceManager.vehicleSystem?.getVehicles?.() ?? null;
    const participantCount = vehicleMap ? vehicleMap.size ?? 0 : 0;
    hud.update({
      throttle: 1 - solarSystem.getZoomLevel(),
      speed: 0,
      crashCount: participantCount,
      elapsedTime,
      distance: altitude,
    });
    const focused = solarSystem.getFocusPlanetId();
    const module = focused ? planetRegistry.get(focused) : null;
    hud.setMapLabel(module?.metadata?.label ?? 'Orbital Overview');
  }

  const activeCamera = surfaceManager.getActiveCamera() ?? camera;
  renderer.render(scene, activeCamera);
}

function enqueueVehicleOp(operation){
  if (!operation) return;
  if (surfaceManager.vehicleSystem){
    try {
      operation(surfaceManager.vehicleSystem);
    } catch (error){
      console.warn('[CloudOfOrbs] Vehicle operation failed', error);
    }
    return;
  }
  vehicleOpsQueue.push(operation);
}

function flushVehicleQueue(){
  if (!surfaceManager.vehicleSystem || vehicleOpsQueue.length === 0){
    return;
  }
  while (vehicleOpsQueue.length){
    const operation = vehicleOpsQueue.shift();
    try {
      operation(surfaceManager.vehicleSystem);
    } catch (error){
      console.warn('[CloudOfOrbs] Deferred vehicle op failed', error);
    }
  }
}

function handleAmmoSelection(ammoId){
  if (!ammoId) return;
  const accepted = ammoManager.setAmmoType(ammoId);
  if (!accepted){
    hud.setActiveAmmo(ammoManager.getCurrentAmmoId());
  }
}

function handlePlanetSelection(planetId){
  if (!planetId) return;
  if (surfaceManager.getState() === PlanetSurfaceState.SYSTEM_VIEW){
    solarSystem.enterSystemView({ planetId });
  } else {
    solarSystem.setFocusPlanet(planetId);
  }
  surfaceManager.selectPlanet(planetId);
  hud.setActiveMap(planetId);
  if (surfaceManager.getState() === PlanetSurfaceState.SYSTEM_VIEW){
    const module = planetRegistry.get(planetId);
    hud.setMapLabel(module?.metadata?.label ?? 'Orbital Overview');
  }
}

function handleSurfaceStateChange({ next, planetId }){
  input.setOrbitalControlsEnabled(next === PlanetSurfaceState.SYSTEM_VIEW);
  if (next === PlanetSurfaceState.SYSTEM_VIEW){
    solarSystem.enterSystemView({ planetId: planetId ?? solarSystem.getFocusPlanetId() });
    applySpaceEnvironment();
  } else {
    solarSystem.exitSystemView();
  }
  matchManager?.handleSurfaceStateChange({ next, planetId });
  if (typeof console !== 'undefined' && typeof console.debug === 'function'){
    console.debug('[CloudOfOrbs] Surface state change', { next, planetId });
  }
  switch (next){
    case PlanetSurfaceState.SYSTEM_VIEW:
      hud.setControls(hudPresets.system);
      hud.setMapLabel('Orbital Overview');
      break;
    case PlanetSurfaceState.APPROACH:
      hud.setControls(hudPresets.approach);
      hud.setMapLabel(planetRegistry.get(planetId)?.metadata?.label ?? 'Approach Vector');
      break;
    case PlanetSurfaceState.SURFACE:
      hud.setControls(hudPresets.surface);
      hud.setMapLabel(planetRegistry.get(planetId)?.metadata?.label ?? 'Surface');
      break;
    case PlanetSurfaceState.DEPARTING:
      hud.setControls(hudPresets.departing);
      hud.setMapLabel(planetRegistry.get(planetId)?.metadata?.label ?? 'Departure Burn');
      break;
    default:
      break;
  }
}

function handleSurfaceReady(){
  flushVehicleQueue();
  matchManager?.handleSurfaceReady();
}

function handleSurfaceDisposed(){
  resetFireInput();
  matchManager?.handleSurfaceDisposed();
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

function applySpaceEnvironment(){
  if (typeof document !== 'undefined' && document.body){
    document.body.style.background = SPACE_ENVIRONMENT.bodyBackground;
  }
  if (scene.background?.set){
    scene.background.set(SPACE_ENVIRONMENT.background);
  } else {
    scene.background = new THREE.Color(SPACE_ENVIRONMENT.background);
  }
  if (scene.fog){
    scene.fog.color.set(SPACE_ENVIRONMENT.fog.color);
    scene.fog.near = SPACE_ENVIRONMENT.fog.near;
    scene.fog.far = SPACE_ENVIRONMENT.fog.far;
  }
  hemisphere.color.set(SPACE_ENVIRONMENT.hemisphere.skyColor);
  hemisphere.groundColor.set(SPACE_ENVIRONMENT.hemisphere.groundColor);
  hemisphere.intensity = SPACE_ENVIRONMENT.hemisphere.intensity;
  sunLight.color.set(SPACE_ENVIRONMENT.sun.color);
  sunLight.intensity = SPACE_ENVIRONMENT.sun.intensity;
  sunLight.position.set(
    SPACE_ENVIRONMENT.sun.position[0],
    SPACE_ENVIRONMENT.sun.position[1],
    SPACE_ENVIRONMENT.sun.position[2],
  );
}

function monitorEscapeAltitude(){
  if (surfaceManager.getState() === PlanetSurfaceState.SYSTEM_VIEW){
    escapeAltitudeArmed = false;
    return;
  }
  const vehicleSystem = surfaceManager.vehicleSystem;
  if (!vehicleSystem) return;
  const activeVehicle = vehicleSystem.getActiveVehicle?.();
  if (!activeVehicle || activeVehicle.mode !== 'plane') return;
  const state = vehicleSystem.getVehicleState?.(activeVehicle);
  if (!state) return;
  const altitude = typeof state.altitude === 'number'
    ? state.altitude
    : state.position?.z ?? 0;
  if (!escapeAltitudeArmed && altitude >= ESCAPE_ALTITUDE_THRESHOLD){
    const targetPlanetId = surfaceManager.getActivePlanetId?.()
      ?? lastProximityMetrics?.planetId
      ?? solarSystem.getFocusPlanetId();
    surfaceManager.requestSystemView({ reason: 'escape-altitude', planetId: targetPlanetId ?? null });
    escapeAltitudeArmed = true;
  } else if (escapeAltitudeArmed && altitude <= ESCAPE_ALTITUDE_RESET){
    escapeAltitudeArmed = false;
  }
}
