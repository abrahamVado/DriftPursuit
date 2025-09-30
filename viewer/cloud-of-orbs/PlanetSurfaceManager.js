import { requireTHREE } from '../shared/threeSetup.js';
import { ChaseCamera } from '../sandbox/ChaseCamera.js';
import { CollisionSystem } from '../sandbox/CollisionSystem.js';
import { DEFAULT_WORLD_ENVIRONMENT, initializeWorldForMap } from '../terra/worldFactory.js';
import { createVehicleSystem } from '../terra/vehicles.js';
import { TerraPlaneController, createPlaneMesh } from '../terra/PlaneController.js';
import { CarController, createCarRig } from '../sandbox/CarController.js';
import { TerraProjectileManager } from '../terra/Projectiles.js';

const THREE = requireTHREE();
const ORIGIN_FALLBACK = new THREE.Vector3(0, 0, 0);

class AltitudeTracker {
  constructor({ threshold = 10000, response = 1.6, holdDuration = 1.2 } = {}){
    this.threshold = Math.max(0, threshold ?? 0);
    this.response = Math.max(0.01, response ?? 0.01);
    this.holdDuration = Math.max(0.1, holdDuration ?? 0.1);
    this.raw = 0;
    this.filtered = 0;
    this.sampleAge = Number.POSITIVE_INFINITY;
    this.aboveTimer = 0;
  }

  update(sample, dt = 0){
    const deltaTime = Math.max(0, dt ?? 0);
    const valid = Number.isFinite(sample);
    if (valid){
      this.raw = Math.max(0, sample);
      this.sampleAge = 0;
    } else {
      this.sampleAge += deltaTime;
    }

    const target = valid ? this.raw : this.filtered;
    const blend = deltaTime > 0 ? 1 - Math.exp(-this.response * deltaTime) : 1;
    this.filtered += (target - this.filtered) * blend;
    this.filtered = Math.max(0, this.filtered);

    if (this.filtered >= this.threshold && this.hasRecentSample(this.holdDuration * 2)){
      this.aboveTimer = Math.min(this.holdDuration, this.aboveTimer + deltaTime);
    } else {
      this.aboveTimer = Math.max(0, this.aboveTimer - deltaTime);
    }

    return {
      raw: this.raw,
      smoothed: this.filtered,
      aboveThreshold: this.aboveTimer >= this.holdDuration,
    };
  }

  reset(value = 0){
    const base = Number.isFinite(value) ? Math.max(0, value) : 0;
    this.raw = base;
    this.filtered = base;
    this.sampleAge = Number.POSITIVE_INFINITY;
    this.aboveTimer = 0;
  }

  hasRecentSample(maxAge = 1.5){
    return this.sampleAge <= Math.max(0, maxAge ?? 0);
  }

  getAltitude(){
    return {
      raw: this.raw,
      smoothed: this.filtered,
      aboveThreshold: this.aboveTimer >= this.holdDuration,
    };
  }

  setThreshold(threshold){
    if (!Number.isFinite(threshold)) return;
    this.threshold = Math.max(0, threshold);
  }
}

export const PlanetSurfaceState = Object.freeze({
  SYSTEM_VIEW: 'SYSTEM_VIEW',
  APPROACH: 'APPROACH',
  SURFACE: 'SURFACE',
  DEPARTING: 'DEPARTING',
});

const DEFAULT_DISTANCE_THRESHOLDS = Object.freeze({
  approachEnter: 6000,
  surfaceEnter: 1400,
  departLeave: 2600,
  systemLeave: 5200,
});

const DEFAULT_CHASE_CONFIG = Object.freeze({
  distance: 78,
  height: 26,
  stiffness: 4.2,
  lookStiffness: 6.1,
  forwardResponsiveness: 5,
  pitchInfluence: 0.34,
});

const DEFAULT_PLANE_CAMERA_CONFIG = Object.freeze({
  distance: 82,
  height: 26,
  stiffness: 4.4,
  lookStiffness: 7.2,
  forwardResponsiveness: 5.4,
  pitchInfluence: 0.38,
});

const DEFAULT_CAR_CAMERA_CONFIG = Object.freeze({
  distance: 42,
  height: 14,
  stiffness: 5.8,
  lookStiffness: 7.8,
  forwardResponsiveness: 6.4,
  pitchInfluence: 0.22,
});

function mergeConfig(base, override){
  if (!override) return { ...base };
  const merged = { ...base };
  Object.keys(override).forEach((key) => {
    if (override[key] != null) merged[key] = override[key];
  });
  return merged;
}

function resolveThresholds(metrics = {}, defaults = DEFAULT_DISTANCE_THRESHOLDS){
  const thresholds = metrics.thresholds ?? metrics;
  const approach = thresholds.approachEnter
    ?? thresholds.approachRadius
    ?? thresholds.approach
    ?? defaults.approachEnter;
  const surface = thresholds.surfaceEnter
    ?? thresholds.surfaceRadius
    ?? thresholds.surface
    ?? Math.min(approach, defaults.surfaceEnter);
  const depart = thresholds.departLeave
    ?? thresholds.departRadius
    ?? thresholds.depart
    ?? Math.max(surface * 1.35, defaults.departLeave);
  const system = thresholds.systemLeave
    ?? thresholds.systemRadius
    ?? thresholds.system
    ?? Math.max(depart * 1.4, defaults.systemLeave);
  return {
    approachEnter: approach,
    surfaceEnter: surface,
    departLeave: depart,
    systemLeave: system,
  };
}

function clampNumber(value, fallback){
  return Number.isFinite(value) ? value : fallback;
}

export class PlanetSurfaceManager {
  constructor({
    scene,
    camera,
    planetRegistry,
    orbitalCameraRig = null,
    chaseCameraConfig = {},
    thresholds = DEFAULT_DISTANCE_THRESHOLDS,
    hud = null,
    hudPresets = {},
    environment = {},
    collisionSystem = null,
    projectileManager = null,
    vehicleSystemFactory = createVehicleSystem,
    worldInitializer = initializeWorldForMap,
    maxDefaultVehicles = 5,
    skyCeiling = 1800,
    escapeAltitude = 10000,
    escapeHoldDuration = 1.1,
    altitudeResponse = 1.8,
    localPlayerId = 'pilot-local',
    planeCameraConfig = {},
    carCameraConfig = {},
    createPlaneController = () => new TerraPlaneController(),
    createCarController = () => new CarController(),
    createPlaneMeshFn = createPlaneMesh,
    createCarRigFn = createCarRig,
    onStateChange = null,
    onSurfaceReady = null,
    onSurfaceDisposed = null,
    defaultSurfaceDescriptor = null,
  } = {}){
    this.scene = scene ?? null;
    this.camera = camera ?? null;
    this.orbitalCameraRig = orbitalCameraRig ?? null;
    this.planetRegistry = planetRegistry instanceof Map
      ? planetRegistry
      : new Map(Object.entries(planetRegistry ?? {}));
    this.hud = hud;
    this.hudPresets = hudPresets ?? {};
    this.defaultMapLabel = 'Orbital Overview';
    this.environment = {
      document: environment.document ?? (typeof document !== 'undefined' ? document : null),
      hemisphere: environment.hemisphere ?? null,
      sun: environment.sun ?? null,
      defaults: environment.defaults ?? DEFAULT_WORLD_ENVIRONMENT,
    };
    this.defaultSurfaceDescriptor = defaultSurfaceDescriptor;

    this.thresholdDefaults = thresholds ?? DEFAULT_DISTANCE_THRESHOLDS;

    this.collisionSystem = collisionSystem ?? new CollisionSystem({ world: null, crashMargin: 2.4, obstaclePadding: 3.2 });
    this.projectileManager = projectileManager ?? new TerraProjectileManager({ scene: this.scene, world: null });
    this.ownsProjectileManager = !projectileManager;

    this.vehicleSystemFactory = vehicleSystemFactory ?? createVehicleSystem;
    this.worldInitializer = worldInitializer ?? initializeWorldForMap;

    this.maxDefaultVehicles = clampNumber(maxDefaultVehicles, 5);
    this.skyCeiling = clampNumber(skyCeiling, 1800);
    this.escapeAltitude = Math.max(0, Number.isFinite(escapeAltitude) ? escapeAltitude : 0);
    this.localPlayerId = localPlayerId;

    this.planeCameraConfig = mergeConfig(DEFAULT_PLANE_CAMERA_CONFIG, planeCameraConfig);
    this.carCameraConfig = mergeConfig(DEFAULT_CAR_CAMERA_CONFIG, carCameraConfig);

    const chaseConfig = mergeConfig(DEFAULT_CHASE_CONFIG, chaseCameraConfig);
    this.chaseCamera = new ChaseCamera(this.camera, chaseConfig);

    this.vehicleSystemOptions = {
      THREE,
      scene: this.scene,
      chaseCamera: this.chaseCamera,
      hud: this.hud,
      hudPresets: this.hudPresets,
      projectileManager: this.projectileManager,
      collisionSystem: this.collisionSystem,
      getWorld: () => this.worldRef.current,
      localPlayerId: this.localPlayerId,
      planeCameraConfig: this.planeCameraConfig,
      carCameraConfig: this.carCameraConfig,
      maxDefaultVehicles: this.maxDefaultVehicles,
      skyCeiling: this.skyCeiling,
      createPlaneMesh: createPlaneMeshFn,
      createPlaneController,
      createCarRig: createCarRigFn,
      createCarController,
    };

    this.altitudeTracker = new AltitudeTracker({
      threshold: this.escapeAltitude,
      response: altitudeResponse,
      holdDuration: escapeHoldDuration,
    });
    this.lastAltitudeEstimate = { raw: 0, smoothed: 0, aboveThreshold: false };

    this.state = PlanetSurfaceState.SYSTEM_VIEW;
    this.activeCameraRig = this.orbitalCameraRig;

    this.worldRef = { current: null };
    this.surfaceContext = null;
    this.vehicleSystem = null;
    this.surfaceReady = false;
    this.surfaceActivationPromise = null;

    this.selectedPlanetId = null;
    this.currentPlanetId = null;
    this.lastProximityMetrics = null;
    this.pendingExitToSystemView = null;
    this.lastExitReason = null;

    this.pendingAssetLoads = new Map();

    this.callbacks = {
      stateChange: typeof onStateChange === 'function' ? onStateChange : null,
      surfaceReady: typeof onSurfaceReady === 'function' ? onSurfaceReady : null,
      surfaceDisposed: typeof onSurfaceDisposed === 'function' ? onSurfaceDisposed : null,
    };
  }

  getState(){
    return this.state;
  }

  getActivePlanetId(){
    return this.currentPlanetId;
  }

  getAltitudeEstimate(){
    if (this.lastAltitudeEstimate){
      return this.lastAltitudeEstimate;
    }
    return this.altitudeTracker?.getAltitude?.() ?? { raw: 0, smoothed: 0, aboveThreshold: false };
  }

  getActiveCamera(){
    if (this.activeCameraRig?.camera) return this.activeCameraRig.camera;
    if (this.state === PlanetSurfaceState.SYSTEM_VIEW && this.orbitalCameraRig?.camera){
      return this.orbitalCameraRig.camera;
    }
    return this.camera ?? null;
  }

  getCameraController(){
    return this.activeCameraRig ?? null;
  }

  selectPlanet(planetId){
    if (!planetId){
      this.selectedPlanetId = null;
      return;
    }
    if (!this.planetRegistry.has(planetId)){
      console.warn('[PlanetSurfaceManager] Unknown planet id', planetId);
      return;
    }
    this.selectedPlanetId = planetId;
    this._preparePlanetAssets(planetId);
  }

  requestSystemView({ immediate = false, reason = 'manual', planetId = null } = {}){
    if (this.state === PlanetSurfaceState.SYSTEM_VIEW){
      return false;
    }

    const targetPlanetId = planetId
      ?? this.currentPlanetId
      ?? this.selectedPlanetId
      ?? this.lastProximityMetrics?.planetId
      ?? null;

    this.lastExitReason = reason;

    if (immediate){
      this.pendingExitToSystemView = null;
      this._transitionTo(PlanetSurfaceState.SYSTEM_VIEW, { planetId: null });
      return true;
    }

    this.pendingExitToSystemView = {
      planetId: targetPlanetId,
      reason,
    };

    if (this.state !== PlanetSurfaceState.DEPARTING){
      this._transitionTo(PlanetSurfaceState.DEPARTING, { planetId: targetPlanetId });
    }

    return true;
  }

  update({
    dt = 0,
    elapsedTime = 0,
    inputSample = null,
    orbitInput = null,
    proximityMetrics = null,
  } = {}){
    if (proximityMetrics){
      this.lastProximityMetrics = proximityMetrics;
      if (!this.selectedPlanetId && proximityMetrics.planetId){
        this.selectedPlanetId = proximityMetrics.planetId;
      }
    }

    const metrics = proximityMetrics ?? this.lastProximityMetrics;
    this._stepStateMachine(metrics);

    if (this.state === PlanetSurfaceState.SYSTEM_VIEW){
      this._updateSystemView(dt, orbitInput, metrics);
      return;
    }

    this._ensureSurfaceActivation();
    if (!this.surfaceReady){
      return;
    }

    this._updateSurfaceSession({ dt, elapsedTime, inputSample, orbitInput });
  }

  dispose(){
    this._teardownSurface();
    if (this.ownsProjectileManager && this.projectileManager){
      this.projectileManager.setWorld?.(null);
      this.projectileManager.setScene?.(null);
    }
    this.pendingAssetLoads.clear();
  }

  _updateSystemView(dt, orbitInput, metrics){
    if (this.orbitalCameraRig?.update){
      this.orbitalCameraRig.update(dt, metrics ?? {}, orbitInput);
    }
    const altitudeSample = Number.isFinite(metrics?.altitude)
      ? metrics.altitude
      : Number.isFinite(metrics?.distanceToSurface)
        ? metrics.distanceToSurface
        : null;
    const altitudeEstimate = this.altitudeTracker
      ? this.altitudeTracker.update(altitudeSample, dt)
      : { raw: altitudeSample ?? 0, smoothed: altitudeSample ?? 0 };
    this.lastAltitudeEstimate = altitudeEstimate;
    if (this.hud && typeof this.hud.update === 'function'){
      const distance = Number.isFinite(altitudeEstimate?.smoothed)
        ? altitudeEstimate.smoothed
        : 0;
      this.hud.update({ throttle: 0, speed: 0, crashCount: 0, elapsedTime: 0, distance });
    }
  }

  _updateSurfaceSession({ dt, elapsedTime, inputSample, orbitInput }){
    if (!this.vehicleSystem) return;
    const { activeVehicle, activeState, hudData } = this.vehicleSystem.update({
      dt,
      elapsedTime,
      inputSample,
    });

    if (this.projectileManager){
      this.projectileManager.update?.(dt, {
        vehicles: this.vehicleSystem.getVehicles?.(),
        onVehicleHit: (vehicle, projectile) => {
          this.vehicleSystem.handleProjectileHit?.(vehicle, projectile);
        },
        onImpact: (impact) => {
          if (this.worldRef.current && typeof this.worldRef.current.applyProjectileImpact === 'function'){
            this.worldRef.current.applyProjectileImpact(impact);
          }
        },
      });
    }

    if (activeVehicle && activeState){
      const mode = activeVehicle.modes?.[activeVehicle.mode];
      if (mode?.cameraConfig){
        this.chaseCamera.setConfig(mode.cameraConfig);
      }
      this.chaseCamera.update(activeState, dt, inputSample?.cameraOrbit ?? orbitInput ?? null);
      this.worldRef.current?.update?.(activeState.position ?? ORIGIN_FALLBACK);
    } else if (this.worldRef.current){
      this.worldRef.current.update?.(ORIGIN_FALLBACK);
    }

    const altitudeSample = this._getAltitudeSampleFromState(activeState);
    const altitudeEstimate = this.altitudeTracker
      ? this.altitudeTracker.update(altitudeSample, dt)
      : { raw: altitudeSample ?? 0, smoothed: altitudeSample ?? 0, aboveThreshold: false };
    this.lastAltitudeEstimate = altitudeEstimate;

    if (
      this.escapeAltitude > 0
      && this.state !== PlanetSurfaceState.SYSTEM_VIEW
      && altitudeEstimate?.aboveThreshold
    ){
      const planetId = this.currentPlanetId ?? this.selectedPlanetId ?? null;
      this.requestSystemView({ immediate: true, reason: 'escape-altitude', planetId });
      return;
    }

    if (this.hud && typeof this.hud.update === 'function'){
      const hudPayload = { ...(hudData ?? {}) };
      if (Number.isFinite(altitudeEstimate?.smoothed)){
        hudPayload.distance = altitudeEstimate.smoothed;
      }
      this.hud.update(hudPayload);
    }
  }

  _stepStateMachine(metrics){
    const fallbackDistance = clampNumber(
      metrics?.distanceToSurface ?? metrics?.distance ?? Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    );
    const hasRecentAltitude = this.altitudeTracker?.hasRecentSample?.(2.5) ?? false;
    const trackedAltitude = this.altitudeTracker?.getAltitude?.();
    const canUseTrackedAltitude = hasRecentAltitude && this.state !== PlanetSurfaceState.SYSTEM_VIEW;
    const distance = canUseTrackedAltitude && Number.isFinite(trackedAltitude?.smoothed)
      ? trackedAltitude.smoothed
      : fallbackDistance;
    const effectiveMetrics = metrics ? { ...metrics } : {};
    if (Number.isFinite(distance)){
      effectiveMetrics.distanceToSurface = distance;
      effectiveMetrics.altitude = distance;
    }
    const planetId = effectiveMetrics.planetId ?? this.selectedPlanetId ?? this.currentPlanetId;
    const thresholds = resolveThresholds(effectiveMetrics, this.thresholdDefaults);
    const previousState = this.state;

    if (this.pendingExitToSystemView){
      if (this.state === PlanetSurfaceState.SYSTEM_VIEW){
        this.pendingExitToSystemView = null;
      } else if (this.state === PlanetSurfaceState.DEPARTING){
        this._transitionTo(PlanetSurfaceState.SYSTEM_VIEW, { planetId: null });
        this.pendingExitToSystemView = null;
      } else {
        this._transitionTo(PlanetSurfaceState.DEPARTING, { planetId: this.pendingExitToSystemView.planetId ?? planetId });
      }
    }

    switch (this.state){
      case PlanetSurfaceState.SYSTEM_VIEW:
        if (planetId && distance <= thresholds.approachEnter){
          this._transitionTo(PlanetSurfaceState.APPROACH, { planetId });
        }
        break;
      case PlanetSurfaceState.APPROACH:
        if (!planetId || distance > thresholds.systemLeave){
          this._transitionTo(PlanetSurfaceState.SYSTEM_VIEW, { planetId: null });
        } else if (distance <= thresholds.surfaceEnter){
          this._transitionTo(PlanetSurfaceState.SURFACE, { planetId });
        }
        break;
      case PlanetSurfaceState.SURFACE:
        if (!planetId || distance >= thresholds.departLeave){
          this._transitionTo(PlanetSurfaceState.DEPARTING, { planetId });
        }
        break;
      case PlanetSurfaceState.DEPARTING:
        if (!planetId || distance >= thresholds.systemLeave){
          this._transitionTo(PlanetSurfaceState.SYSTEM_VIEW, { planetId: null });
        } else if (distance <= thresholds.surfaceEnter){
          this._transitionTo(PlanetSurfaceState.SURFACE, { planetId });
        }
        break;
      default:
        this._transitionTo(PlanetSurfaceState.SYSTEM_VIEW, { planetId: null });
    }

    if (previousState !== this.state){
      if (typeof console !== 'undefined' && typeof console.debug === 'function'){
        console.debug('[PlanetSurfaceManager] State change', {
          previous: previousState,
          next: this.state,
          planetId: this.currentPlanetId,
          exitReason: this.lastExitReason ?? 'auto',
        });
      }
      if (this.callbacks.stateChange){
        this.callbacks.stateChange({ previous: previousState, next: this.state, planetId: this.currentPlanetId });
      }
      if (this.state === PlanetSurfaceState.SYSTEM_VIEW){
        this.lastExitReason = null;
      }
    }
    this.lastProximityMetrics = effectiveMetrics;
  }

  _transitionTo(nextState, { planetId } = {}){
    if (this.state === nextState && (nextState === PlanetSurfaceState.SYSTEM_VIEW || planetId === this.currentPlanetId)){
      return;
    }

    const previous = this.state;
    this.state = nextState;

    if (nextState === PlanetSurfaceState.SYSTEM_VIEW){
      this._teardownSurface();
      this.currentPlanetId = null;
      this.activeCameraRig = this.orbitalCameraRig ?? null;
      this._applyHudPreset('system');
      this._setHudMapLabel('Orbital Overview');
      return;
    }

    if (planetId){
      this.currentPlanetId = planetId;
      this._preparePlanetAssets(planetId);
    }

    if (nextState === PlanetSurfaceState.APPROACH){
      this.activeCameraRig = this.chaseCamera;
      this._applyHudPreset('approach');
      this._setHudMapLabel(this._getPlanetLabel(planetId));
      return;
    }

    if (nextState === PlanetSurfaceState.SURFACE){
      this.activeCameraRig = this.chaseCamera;
      this._ensureSurfaceActivation();
      this._applyHudPreset('surface');
      return;
    }

    if (nextState === PlanetSurfaceState.DEPARTING){
      this.activeCameraRig = this.chaseCamera;
      this._applyHudPreset('departing');
      return;
    }
  }

  _getAltitudeSampleFromState(state){
    if (!state) return null;
    if (Number.isFinite(state.altitude)){
      return Math.max(0, state.altitude);
    }
    if (state.position && this.worldRef.current?.getHeightAt){
      const ground = this.worldRef.current.getHeightAt(state.position.x, state.position.y);
      if (Number.isFinite(ground)){
        return Math.max(0, state.position.z - ground);
      }
    }
    return null;
  }

  _applyHudPreset(name){
    if (!this.hud) return;
    const presets = this.hudPresets ?? {};
    const preset = presets[name] ?? presets.surface ?? presets.plane ?? null;
    if (preset && typeof this.hud.setControls === 'function'){
      this.hud.setControls(preset);
    }
  }

  _setHudMapLabel(text){
    if (!this.hud) return;
    const label = typeof text === 'string' && text.trim()
      ? text
      : this.defaultMapLabel;
    if (!label) return;
    if (typeof this.hud.setMapLabel === 'function'){
      this.hud.setMapLabel(label);
      return;
    }
    if (this.hud.mapLabel && typeof this.hud.mapLabel.textContent === 'string'){
      this.hud.mapLabel.textContent = label;
    }
  }

  _getPlanetLabel(planetId){
    const module = planetId ? this.planetRegistry.get(planetId) : null;
    return module?.metadata?.label ?? planetId ?? 'Surface';
  }

  _preparePlanetAssets(planetId){
    const module = this.planetRegistry.get(planetId);
    if (!module || typeof module.loadDetailAssets !== 'function') return null;
    if (this.pendingAssetLoads.has(planetId)){
      return this.pendingAssetLoads.get(planetId);
    }
    const promise = Promise.resolve()
      .then(() => module.loadDetailAssets())
      .catch((error) => {
        console.warn(`[PlanetSurfaceManager] Failed to load detail assets for ${planetId}`, error);
        return null;
      })
      .finally(() => {
        if (this.pendingAssetLoads.get(planetId) === promise){
          this.pendingAssetLoads.delete(planetId);
        }
      });
    this.pendingAssetLoads.set(planetId, promise);
    return promise;
  }

  _ensureSurfaceActivation(force = false){
    if (this.surfaceReady && !force) return;
    if (!this.currentPlanetId) return;
    if (this.surfaceActivationPromise) return;

    this.surfaceActivationPromise = this._activateSurface(this.currentPlanetId)
      .catch((error) => {
        console.error('[PlanetSurfaceManager] Failed to activate surface', error);
      })
      .finally(() => {
        this.surfaceActivationPromise = null;
      });
  }

  async _activateSurface(planetId){
    const module = this.planetRegistry.get(planetId) ?? null;
    if (!module){
      console.warn('[PlanetSurfaceManager] No module registered for planet', planetId);
      this.surfaceReady = false;
      return null;
    }

    if (module.loadDetailAssets){
      try {
        await module.loadDetailAssets();
      } catch (error){
        console.warn(`[PlanetSurfaceManager] Detail asset load rejected for ${planetId}`, error);
      }
    }

    const descriptorFactory = typeof module.createSurfaceDescriptor === 'function'
      ? module.createSurfaceDescriptor
      : null;
    let mapDefinition = descriptorFactory ? descriptorFactory({ planetId, metadata: module.metadata ?? {} }) : null;
    if (!mapDefinition && typeof this.defaultSurfaceDescriptor === 'function'){
      mapDefinition = this.defaultSurfaceDescriptor({ planetId, metadata: module.metadata ?? {} });
    } else if (!mapDefinition && this.defaultSurfaceDescriptor){
      mapDefinition = this.defaultSurfaceDescriptor;
    }

    if (!mapDefinition){
      console.warn('[PlanetSurfaceManager] Planet does not provide a surface descriptor', planetId);
      this.surfaceReady = false;
      return null;
    }

    const worldResult = this.worldInitializer({
      scene: this.scene,
      mapDefinition,
      currentWorld: this.worldRef.current,
      collisionSystem: this.collisionSystem,
      projectileManager: this.projectileManager,
      environment: this.environment,
    });

    this.worldRef.current = worldResult.world;
    this.surfaceContext = {
      planetId,
      mapDefinition: worldResult.mapDefinition ?? mapDefinition,
      module,
    };

    this._resetVehiclePopulation();

    this.surfaceReady = true;
    this.altitudeTracker?.reset?.(0);
    this.lastAltitudeEstimate = this.altitudeTracker?.getAltitude?.() ?? { raw: 0, smoothed: 0, aboveThreshold: false };
    this._setHudMapLabel(this.surfaceContext.mapDefinition?.name ?? this._getPlanetLabel(planetId));
    if (this.callbacks.surfaceReady){
      this.callbacks.surfaceReady({ planetId, context: this.surfaceContext });
    }
    return this.surfaceContext;
  }

  _resetVehiclePopulation(){
    if (!this.vehicleSystem){
      this.vehicleSystem = this.vehicleSystemFactory(this.vehicleSystemOptions);
    }
    if (!this.vehicleSystem) return;

    const vehicles = this.vehicleSystem.getVehicles?.();
    if (vehicles && typeof vehicles.clear === 'function'){
      for (const vehicle of vehicles.values()){
        const planeMesh = vehicle?.modes?.plane?.mesh;
        if (planeMesh) this.scene?.remove?.(planeMesh);
        const carMesh = vehicle?.modes?.car?.rig?.carMesh;
        if (carMesh) this.scene?.remove?.(carMesh);
      }
      vehicles.clear();
    }

    this.vehicleSystem.spawnDefaultVehicles?.();
    this.vehicleSystem.handlePlayerJoin?.(this.localPlayerId, { initialMode: 'plane' });

    const vehicleMap = this.vehicleSystem.getVehicles?.() ?? null;
    let fallbackVehicle = null;
    if (vehicleMap && typeof vehicleMap.values === 'function'){
      const iterator = vehicleMap.values();
      const first = iterator.next();
      fallbackVehicle = first && !first.done ? first.value : null;
    }

    const initialVehicle = this.vehicleSystem.getActiveVehicle?.()
      ?? (vehicleMap && typeof vehicleMap.get === 'function' ? vehicleMap.get(this.localPlayerId) : null)
      ?? fallbackVehicle;
    if (initialVehicle){
      const state = this.vehicleSystem.getVehicleState?.(initialVehicle);
      if (state){
        this.chaseCamera.snapTo(state);
        this.worldRef.current?.update?.(state.position ?? ORIGIN_FALLBACK);
      }
    }
  }

  _teardownSurface(){
    this.surfaceReady = false;
    this.altitudeTracker?.reset?.(0);
    this.lastAltitudeEstimate = this.altitudeTracker?.getAltitude?.() ?? { raw: 0, smoothed: 0, aboveThreshold: false };
    if (this.vehicleSystem){
      const vehicles = this.vehicleSystem.getVehicles?.();
      if (vehicles && typeof vehicles.clear === 'function'){
        for (const vehicle of vehicles.values()){
          const planeMesh = vehicle?.modes?.plane?.mesh;
          if (planeMesh) this.scene?.remove?.(planeMesh);
          const carMesh = vehicle?.modes?.car?.rig?.carMesh;
          if (carMesh) this.scene?.remove?.(carMesh);
        }
        vehicles.clear();
      }
    }

    if (this.projectileManager){
      if (Array.isArray(this.projectileManager.projectiles)){
        for (const projectile of this.projectileManager.projectiles){
          if (typeof this.projectileManager._disposeProjectile === 'function'){
            this.projectileManager._disposeProjectile(projectile);
          } else if (projectile?.mesh && this.scene){
            this.scene.remove(projectile.mesh);
            projectile.mesh.material?.dispose?.();
          }
        }
        this.projectileManager.projectiles.length = 0;
      }
      if (Array.isArray(this.projectileManager.explosions)){
        for (let i = this.projectileManager.explosions.length - 1; i >= 0; i -= 1){
          if (typeof this.projectileManager._disposeExplosionAt === 'function'){
            this.projectileManager._disposeExplosionAt(i);
          } else {
            const explosion = this.projectileManager.explosions[i];
            if (explosion?.mesh && this.scene){
              this.scene.remove(explosion.mesh);
            }
            this.projectileManager.explosions.splice(i, 1);
          }
        }
      }
      this.projectileManager.setWorld?.(null);
    }

    if (this.worldRef.current?.dispose){
      this.worldRef.current.dispose();
    }
    this.worldRef.current = null;
    if (this.collisionSystem){
      this.collisionSystem.setWorld?.(null);
    }
    if (this.callbacks.surfaceDisposed && this.surfaceContext){
      this.callbacks.surfaceDisposed({ planetId: this.surfaceContext.planetId, context: this.surfaceContext });
    }
    this.surfaceContext = null;
  }
}

export default PlanetSurfaceManager;
