import { requireTHREE } from '../shared/threeSetup.js';
import { OrbitalPlayerShip } from './OrbitalPlayerShip.js';

const THREE = requireTHREE();

const TMP_TARGET = new THREE.Vector3();
const TMP_FORWARD = new THREE.Vector3();
const TMP_RIGHT = new THREE.Vector3();
const TMP_UP = new THREE.Vector3(0, 0, 1);
const TMP_PLANET_POS = new THREE.Vector3();
const TMP_RADIAL = new THREE.Vector3();
const TMP_SHIP_POS = new THREE.Vector3();

const DEFAULT_RADIUS_SCALE = 180;
const DEFAULT_ORBIT_SCALE = 4200;
const CAMERA_BLEND_RATE = 6.4;
const CAMERA_LOOK_BLEND = 5.6;
const DISTANCE_BLEND_RATE = 5.1;
const CAMERA_ORBIT_DECAY = 3.2;
const MAX_ORBIT_YAW = THREE.MathUtils.degToRad(145);
const MAX_ORBIT_PITCH = THREE.MathUtils.degToRad(72);

function createFallbackMesh(label = 'Body'){
  const geometry = new THREE.SphereGeometry(1, 24, 24);
  const material = new THREE.MeshStandardMaterial({ color: 0x9cb3ff, roughness: 0.68 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = label;
  return mesh;
}

function cloneThresholds(thresholds){
  if (!thresholds) return null;
  return {
    approachEnter: thresholds.approachEnter,
    surfaceEnter: thresholds.surfaceEnter,
    departLeave: thresholds.departLeave,
    systemLeave: thresholds.systemLeave,
  };
}

export class SolarSystemWorld {
  constructor({
    scene = null,
    camera = null,
    planetRegistry = new Map(),
    radiusScale = DEFAULT_RADIUS_SCALE,
    orbitScale = DEFAULT_ORBIT_SCALE,
    initialPlanetId = null,
    playerShipFactory = (options) => new OrbitalPlayerShip(options),
  } = {}){
    this.scene = scene;
    this.camera = camera;
    this.radiusScale = radiusScale;
    this.orbitScale = orbitScale;

    this.root = new THREE.Group();
    this.root.name = 'SolarSystemWorld';
    if (this.scene){
      this.scene.add(this.root);
    }

    this.planets = new Map();
    this.planetList = [];

    this.cameraTarget = new THREE.Vector3();
    this.cameraPosition = new THREE.Vector3();
    this.orbitAngles = { yaw: 0, pitch: 0 };
    this.lastOrbitInput = null;
    this.lastInputOrbitActive = false;

    this.followDistance = 620;
    this.targetFollowDistance = this.followDistance;
    this.followMinDistance = 260;
    this.followMaxDistance = 3600;
    this.zoomSpeed = 620;
    this.zoomNormalized = 0;

    this.minDistance = 1800;
    this.maxDistance = 38000;

    this.metrics = {
      planetId: null,
      distanceToSurface: Number.POSITIVE_INFINITY,
      altitude: Number.POSITIVE_INFINITY,
      thresholds: null,
    };

    this._initializePlanets(planetRegistry);

    this.playerShipFactory = playerShipFactory;
    this.playerShip = this.playerShipFactory?.({ scene: this.root }) ?? null;
    this.playerShipNeedsPlacement = true;
    this.systemViewActive = true;
    this.lastShipState = this.playerShip?.getState?.() ?? {
      position: new THREE.Vector3(),
      orientation: new THREE.Quaternion(),
      velocity: new THREE.Vector3(),
      forward: new THREE.Vector3(0, 1, 0),
      up: new THREE.Vector3(0, 0, 1),
    };

    this.focusPlanetId = initialPlanetId ?? this._getDefaultPlanetId();
    this.setFocusPlanet(this.focusPlanetId);

    this.savedShipState = null;
    this.savedShipFocusPlanetId = null;

    this.cameraRig = {
      camera: this.camera,
      update: (dt, _metrics, orbitInput) => {
        const planet = this.planets.get(this.focusPlanetId);
        this._updateCamera(dt, orbitInput, this.lastShipState, planet);
      },
    };
  }

  dispose(){
    if (this.scene && this.root){
      this.scene.remove(this.root);
    }
    this.playerShip?.dispose?.();
    this.planets.clear();
    this.planetList.length = 0;
  }

  getCameraRig(){
    return this.cameraRig;
  }

  getFocusPlanetId(){
    return this.focusPlanetId;
  }

  getPlanetOptions(){
    return this.planetList.map(({ id, metadata }) => ({
      id,
      name: metadata.label ?? id,
      description: metadata.description ?? '',
    }));
  }

  getProximityMetrics(){
    const { planetId, distanceToSurface, altitude, thresholds } = this.metrics;
    return {
      planetId,
      distanceToSurface,
      altitude,
      thresholds: cloneThresholds(thresholds),
    };
  }

  getZoomLevel(){
    return this.zoomNormalized;
  }

  enterSystemView({ planetId = null } = {}){
    const wasActive = this.systemViewActive;
    this.systemViewActive = true;
    if (this.root){
      this.root.visible = true;
    }
    const forcePlacement = Boolean(planetId);
    if (forcePlacement){
      this.playerShipNeedsPlacement = true;
    } else if (!wasActive){
      this.playerShipNeedsPlacement = true;
    }
    this.playerShip?.setActive(true);
    this.playerShip?.setVisible(true);
    if (planetId && planetId !== this.focusPlanetId){
      this.setFocusPlanet(planetId);
      return;
    }
    if (!this.playerShipNeedsPlacement){
      return;
    }
    const planet = this.planets.get(this.focusPlanetId);
    if (planet){
      this._ensureShipPlacement(planet, { snapCamera: true });
    }
  }

  exitSystemView(){
    if (!this.systemViewActive) return;
    this._captureShipStateForReturn();
    this.systemViewActive = false;
    this.playerShipNeedsPlacement = true;
    this.playerShip?.setActive(false);
    this.playerShip?.setVisible(false);
    if (this.root){
      this.root.visible = false;
    }
  }

  cycleFocus(delta = 1){
    if (!Number.isFinite(delta) || this.planetList.length === 0) return this.focusPlanetId;
    const index = this.planetList.findIndex((entry) => entry.id === this.focusPlanetId);
    if (index < 0){
      this.setFocusPlanet(this.planetList[0].id);
      return this.focusPlanetId;
    }
    const nextIndex = (index + delta + this.planetList.length) % this.planetList.length;
    this.setFocusPlanet(this.planetList[nextIndex].id);
    return this.focusPlanetId;
  }

  setFocusPlanet(planetId){
    if (!planetId || !this.planets.has(planetId)){
      return false;
    }
    const entry = this.planets.get(planetId);
    this.focusPlanetId = planetId;
    this.metrics.planetId = planetId;
    this._updateDistanceBounds(entry);
    this._ensureShipPlacement(entry, { snapCamera: true });
    this._updateMetrics(entry);
    return true;
  }

  update(dt = 0, { inputSample = null } = {}){
    const planet = this.planets.get(this.focusPlanetId);
    if (!planet){
      this.metrics.distanceToSurface = Number.POSITIVE_INFINITY;
      this.metrics.altitude = Number.POSITIVE_INFINITY;
      this.metrics.thresholds = null;
      return this.metrics;
    }

    const zoomDelta = inputSample?.system?.zoomDelta ?? 0;
    this._updateZoom(dt, zoomDelta);

    const shouldAnimatePlanets = this.root?.visible !== false;
    if (shouldAnimatePlanets){
      const orbitDelta = dt * planet.orbitAngularSpeed;
      planet.pivot.rotation.y += orbitDelta;
      planet.mesh.rotation.y += dt * planet.spinSpeed;
    }

    if (this.systemViewActive){
      this._ensureShipPlacement(planet);
      const shipState = this.playerShip?.update(dt, inputSample?.plane ?? {}, {});
      if (shipState){
        this.lastShipState = shipState;
        this._updateMetricsFromShip(planet, shipState);
      } else {
        this._updateMetrics(planet);
      }
    } else {
      this._updateMetrics(planet);
    }
    this.lastInputOrbitActive = inputSample?.system?.orbitActive ?? false;
    this.lastOrbitInput = inputSample?.cameraOrbit ?? null;
    return this.metrics;
  }

  _initializePlanets(planetRegistry){
    const registry = planetRegistry instanceof Map
      ? planetRegistry
      : new Map(Object.entries(planetRegistry ?? {}));

    registry.forEach((module, id) => {
      const metadata = module?.metadata ?? { id };
      const planetId = metadata.id ?? id;
      const radius = Math.abs(metadata.radius ?? 1) * this.radiusScale;
      const orbitDistance = Math.abs(metadata.orbitDistance ?? 0) * this.orbitScale;

      const pivot = new THREE.Group();
      pivot.name = `${planetId}-pivot`;

      let mesh = null;
      if (module && typeof module.createOrbitalMesh === 'function'){
        try {
          mesh = module.createOrbitalMesh({ segments: Math.max(16, Math.round(32 + radius * 0.08)) });
        } catch (error){
          console.warn(`[SolarSystemWorld] Failed to create mesh for ${planetId}`, error);
        }
      }
      if (!mesh){
        mesh = createFallbackMesh(metadata.label ?? planetId);
      }

      mesh.scale.setScalar(this.radiusScale);
      mesh.position.set(orbitDistance, 0, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      pivot.add(mesh);
      this.root.add(pivot);

      const orbitAngularSpeed = THREE.MathUtils.degToRad(Math.max(2, 48 / Math.max(0.2, metadata.orbitDistance ?? 1))) * 0.0016;
      const spinSpeed = THREE.MathUtils.degToRad(18 / Math.sqrt(Math.max(0.25, metadata.radius ?? 1))) * 0.45;

      const entry = {
        id: planetId,
        metadata,
        module,
        mesh,
        pivot,
        radius,
        orbitDistance,
        orbitAngularSpeed,
        spinSpeed,
      };
      this.planets.set(planetId, entry);
      this.planetList.push(entry);
    });

    this.planetList.sort((a, b) => a.orbitDistance - b.orbitDistance);
  }

  _getDefaultPlanetId(){
    if (this.planetList.length === 0) return null;
    const earthIndex = this.planetList.findIndex((entry) => entry.id === 'earth');
    if (earthIndex >= 0) return this.planetList[earthIndex].id;
    return this.planetList[Math.min(2, this.planetList.length - 1)].id;
  }

  _updateZoom(dt, zoomDelta){
    if (Number.isFinite(zoomDelta) && zoomDelta !== 0){
      const step = zoomDelta * this.zoomSpeed;
      this.targetFollowDistance = THREE.MathUtils.clamp(
        this.targetFollowDistance - step,
        this.followMinDistance,
        this.followMaxDistance,
      );
    }
    const blend = dt > 0 ? 1 - Math.exp(-DISTANCE_BLEND_RATE * dt) : 1;
    this.followDistance += (this.targetFollowDistance - this.followDistance) * blend;
    this.zoomNormalized = this._computeZoomNormalized();
  }

  _computeZoomNormalized(){
    if (!Number.isFinite(this.followMinDistance) || !Number.isFinite(this.followMaxDistance)) return 0;
    if (this.followMaxDistance <= this.followMinDistance) return 0;
    const ratio = (this.followDistance - this.followMinDistance) / (this.followMaxDistance - this.followMinDistance);
    return THREE.MathUtils.clamp(ratio, 0, 1);
  }

  _updateCamera(dt, orbitInput, shipState, planet){
    if (!this.camera || !shipState?.position) return;

    const input = orbitInput ?? this.lastOrbitInput ?? {};
    const yawDelta = input?.yawDelta ?? 0;
    const pitchDelta = input?.pitchDelta ?? 0;
    const active = input?.active ?? this.lastInputOrbitActive ?? false;

    if (active){
      this.orbitAngles.yaw = THREE.MathUtils.clamp(this.orbitAngles.yaw + yawDelta, -MAX_ORBIT_YAW, MAX_ORBIT_YAW);
      this.orbitAngles.pitch = THREE.MathUtils.clamp(this.orbitAngles.pitch + pitchDelta, -MAX_ORBIT_PITCH, MAX_ORBIT_PITCH);
    } else {
      const decay = dt > 0 ? Math.exp(-CAMERA_ORBIT_DECAY * dt) : 0;
      this.orbitAngles.yaw = THREE.MathUtils.clamp((this.orbitAngles.yaw * decay) + yawDelta * 0.25, -MAX_ORBIT_YAW, MAX_ORBIT_YAW);
      this.orbitAngles.pitch = THREE.MathUtils.clamp((this.orbitAngles.pitch * decay) + pitchDelta * 0.25, -MAX_ORBIT_PITCH, MAX_ORBIT_PITCH);
    }

    const forward = this.playerShip?.getForwardVector(TMP_FORWARD) ?? TMP_FORWARD.set(0, 1, 0);
    const upVector = TMP_UP;

    const rotatedForward = TMP_FORWARD.copy(forward).normalize();
    if (this.orbitAngles.yaw !== 0){
      rotatedForward.applyAxisAngle(upVector, this.orbitAngles.yaw);
    }
    const right = TMP_RIGHT.crossVectors(rotatedForward, upVector);
    if (right.lengthSq() > 1e-5){
      right.normalize();
      if (this.orbitAngles.pitch !== 0){
        rotatedForward.applyAxisAngle(right, this.orbitAngles.pitch);
      }
    }
    rotatedForward.normalize();

    const followDistance = Math.max(this.followDistance, 180);
    const heightBase = planet ? Math.max(followDistance * 0.32, planet.radius * 0.6, 200) : followDistance * 0.32;
    const pitchLift = Math.sin(this.orbitAngles.pitch) * followDistance * 0.45;

    this.cameraPosition.copy(shipState.position)
      .addScaledVector(rotatedForward, -followDistance)
      .addScaledVector(upVector, heightBase + pitchLift);

    const blend = dt > 0 ? 1 - Math.exp(-CAMERA_BLEND_RATE * dt) : 1;
    if (blend >= 1 || !Number.isFinite(blend)){
      this.camera.position.copy(this.cameraPosition);
    } else {
      this.camera.position.lerp(this.cameraPosition, blend);
    }

    const lookOffset = Math.sin(this.orbitAngles.pitch) * 48;
    TMP_TARGET.copy(shipState.position).addScaledVector(upVector, lookOffset);
    const lookBlend = dt > 0 ? 1 - Math.exp(-CAMERA_LOOK_BLEND * dt) : 1;
    if (lookBlend >= 1 || !Number.isFinite(lookBlend)){
      this.cameraTarget.copy(TMP_TARGET);
    } else {
      this.cameraTarget.lerp(TMP_TARGET, lookBlend);
    }

    this.camera.up.copy(upVector);
    this.camera.lookAt(this.cameraTarget);
  }

  _updateDistanceBounds(planet){
    const base = Math.max(planet.radius * 2.6, 1200);
    const orbitInfluence = Math.max(planet.orbitDistance * 0.12, 0);
    this.minDistance = base + orbitInfluence * 0.18;
    this.maxDistance = Math.max(this.minDistance * 4.5, base * 6.8, planet.orbitDistance * 1.4 + base * 1.8);

    const followBase = Math.max(planet.radius * 1.4, 260);
    const followMax = Math.max(followBase * 6.2, this.minDistance * 0.75, followBase + 420);
    this.followMinDistance = followBase;
    this.followMaxDistance = followMax;

    const preferred = Math.max(followBase * 2.4, planet.radius * 3.2, 520);
    const clamped = THREE.MathUtils.clamp(preferred, this.followMinDistance, this.followMaxDistance);

    this.targetFollowDistance = clamped;
    this.followDistance = clamped;
    this.cameraDistance = Math.max(this.minDistance, planet.radius * 3.2);
    this.zoomNormalized = this._computeZoomNormalized();
  }

  _ensureShipPlacement(planet, { snapCamera = false } = {}){
    if (!this.playerShip || !planet) return;
    if (!this.systemViewActive) return;

    const hasSavedState = Boolean(this.savedShipState && this.savedShipFocusPlanetId === planet.id);
    if (!hasSavedState && !this.playerShipNeedsPlacement && this.playerShip.hasLaunched){
      return;
    }

    if (hasSavedState && this._applySavedShipState(planet)){
      if (snapCamera){
        this.orbitAngles.yaw = 0;
        this.orbitAngles.pitch = 0;
        this._updateCamera(0, this.lastOrbitInput, this.lastShipState, planet);
      }
      return;
    }

    const spawn = this._computeShipSpawnPosition(planet);
    this.playerShip.setPosition(spawn.position, { keepVelocity: false });
    this._orientShipAwayFromPlanet(planet, { alignVelocity: true, speed: this.playerShip?.velocity?.length?.() ?? 0 });
    this.playerShip.setActive(true);
    this.playerShip.setVisible(true);
    this.playerShipNeedsPlacement = false;
    this.lastShipState = this.playerShip.getState();
    this._updateMetricsFromShip(planet, this.lastShipState);

    if (snapCamera){
      this.orbitAngles.yaw = 0;
      this.orbitAngles.pitch = 0;
      this._updateCamera(0, this.lastOrbitInput, this.lastShipState, planet);
    }
  }

  _computeShipSpawnPosition(planet){
    const planetPosition = planet.mesh.getWorldPosition(TMP_PLANET_POS);
    const radial = TMP_RADIAL.copy(planetPosition);
    if (radial.lengthSq() < 1e-6){
      radial.set(1, 0, 0);
    }
    radial.normalize();

    const tangent = TMP_RIGHT.set(0, 0, 1).cross(radial);
    if (tangent.lengthSq() < 1e-6){
      tangent.set(0, 1, 0);
    }
    tangent.normalize();

    const altitude = Math.max(planet.radius * 1.25, 520);
    const standoff = Math.max(planet.radius * 4.2, 1200 + planet.orbitDistance * 0.12);

    const position = planetPosition.clone()
      .addScaledVector(radial, altitude)
      .addScaledVector(tangent, standoff);

    return { position, target: planetPosition.clone() };
  }

  _captureShipStateForReturn(){
    if (!this.playerShip || !this.focusPlanetId) return;
    const state = this.playerShip.getState?.();
    if (!state?.position || !state?.orientation){
      return;
    }
    this.savedShipState = {
      position: state.position.clone(),
      orientation: state.orientation.clone(),
      velocity: state.velocity?.clone?.() ?? new THREE.Vector3(),
      forward: this.playerShip.getForwardVector?.(new THREE.Vector3())
        ?? state.forward?.clone?.()
        ?? new THREE.Vector3(0, 1, 0),
      up: this.playerShip.getUpVector?.(new THREE.Vector3())
        ?? state.up?.clone?.()
        ?? new THREE.Vector3(0, 0, 1),
      throttle: typeof this.playerShip.throttle === 'number' ? this.playerShip.throttle : 0,
      hasLaunched: Boolean(this.playerShip.hasLaunched),
    };
    this.savedShipFocusPlanetId = this.focusPlanetId;
  }

  _applySavedShipState(planet){
    if (!this.savedShipState || this.savedShipFocusPlanetId !== planet.id){
      return false;
    }

    const { position, velocity, throttle, hasLaunched } = this.savedShipState;
    const speed = velocity.length?.() ?? 0;

    this.playerShip.setPosition(position, { keepVelocity: true });
    if (this.playerShip.velocity && velocity){
      this.playerShip.velocity.copy(velocity);
    }
    if (typeof throttle === 'number'){
      this.playerShip.throttle = throttle;
      this.playerShip.speed = speed;
      if (typeof this.playerShip._applyPropulsorIntensity === 'function'){
        this.playerShip._applyPropulsorIntensity(throttle);
      }
    }
    this.playerShip.hasLaunched = hasLaunched || this.playerShip.hasLaunched;

    this._orientShipAwayFromPlanet(planet, {
      alignVelocity: true,
      speed: speed > 0 ? speed : this.playerShip.velocity?.length?.() ?? 0,
    });
    this.playerShip.setActive(true);
    this.playerShip.setVisible(true);
    this.playerShipNeedsPlacement = false;

    this.lastShipState = this.playerShip.getState?.() ?? this.savedShipState;
    this._updateMetricsFromShip(planet, this.lastShipState);

    const planetPosition = planet.mesh.getWorldPosition(TMP_PLANET_POS);
    this.cameraDistance = position.distanceTo(planetPosition);

    this.savedShipState = null;
    this.savedShipFocusPlanetId = null;
    return true;
  }

  _orientShipAwayFromPlanet(planet, { alignVelocity = false, speed = 0 } = {}){
    if (!this.playerShip || !planet) return;
    const planetPosition = planet.mesh.getWorldPosition(TMP_PLANET_POS);
    const shipPosition = this.playerShip.getPosition?.(TMP_SHIP_POS)
      ?? TMP_SHIP_POS.copy(this.playerShip.mesh?.position ?? TMP_SHIP_POS.set(0, 0, 0));
    const outward = TMP_FORWARD.copy(shipPosition).sub(planetPosition);
    if (outward.lengthSq() < 1e-6){
      outward.set(0, 1, 0);
    } else {
      outward.normalize();
    }
    const lookTarget = TMP_TARGET.copy(shipPosition).add(outward);
    this.playerShip.lookTowards(lookTarget, { up: TMP_UP });
    if (alignVelocity && this.playerShip.velocity){
      const magnitude = Number.isFinite(speed) && speed > 0
        ? speed
        : this.playerShip.velocity.length();
      this.playerShip.velocity.copy(outward).multiplyScalar(magnitude);
      this.playerShip.speed = magnitude;
    }
  }

  _updateMetricsFromShip(planet, shipState){
    if (!planet || !shipState?.position) return;
    const planetPosition = planet.mesh.getWorldPosition(TMP_PLANET_POS);
    const distanceToCenter = shipState.position.distanceTo(planetPosition);
    const altitude = Math.max(0, distanceToCenter - planet.radius);
    this.cameraDistance = distanceToCenter;
    this.metrics.planetId = planet.id;
    this.metrics.distanceToSurface = altitude;
    this.metrics.altitude = altitude;
    this.metrics.thresholds = this._computeThresholds(planet);
  }

  _updateMetrics(planet){
    if (!planet){
      this.metrics.distanceToSurface = Number.POSITIVE_INFINITY;
      this.metrics.altitude = Number.POSITIVE_INFINITY;
      this.metrics.thresholds = null;
      return;
    }
    const thresholds = this._computeThresholds(planet);
    const referenceDistance = Number.isFinite(this.cameraDistance)
      ? this.cameraDistance
      : Math.max(this.minDistance, planet.radius * 3.2);
    const altitude = Math.max(0, referenceDistance - planet.radius);
    this.metrics.planetId = planet.id;
    this.metrics.distanceToSurface = altitude;
    this.metrics.altitude = altitude;
    this.metrics.thresholds = thresholds;
  }

  _computeThresholds(planet){
    const base = Math.max(this.minDistance, planet.radius * 2.8);
    const surface = Math.max(planet.radius * 1.4, base * 0.55);
    const depart = Math.max(surface * 1.6, base * 0.9);
    const approach = Math.max(depart * 1.32, base * 1.25);
    const system = Math.max(approach * 1.45, depart * 1.75);
    return {
      approachEnter: approach,
      surfaceEnter: surface,
      departLeave: depart,
      systemLeave: system,
    };
  }
}

export default SolarSystemWorld;
