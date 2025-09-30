import { requireTHREE } from '../shared/threeSetup.js';

const THREE = requireTHREE();

const TMP_SPHERICAL = new THREE.Spherical();

const DEFAULT_RADIUS_SCALE = 120;
const DEFAULT_ORBIT_SCALE = 3200;
const DEFAULT_AUTO_ORBIT_SPEED = 0.045;
const CAMERA_BLEND_RATE = 6.4;
const DISTANCE_BLEND_RATE = 5.1;

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
    autoOrbitSpeed = DEFAULT_AUTO_ORBIT_SPEED,
    initialPlanetId = null,
  } = {}){
    this.scene = scene;
    this.camera = camera;
    this.radiusScale = radiusScale;
    this.orbitScale = orbitScale;
    this.autoOrbitSpeed = autoOrbitSpeed;

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
    this.autoOrbitEnabled = true;

    this.cameraDistance = 6400;
    this.targetCameraDistance = this.cameraDistance;
    this.minDistance = 1800;
    this.maxDistance = 38000;
    this.zoomSpeed = 620;
    this.zoomNormalized = 0.25;

    this.metrics = {
      planetId: null,
      distanceToSurface: Number.POSITIVE_INFINITY,
      altitude: Number.POSITIVE_INFINITY,
      thresholds: null,
    };

    this._initializePlanets(planetRegistry);

    this.focusPlanetId = initialPlanetId ?? this._getDefaultPlanetId();
    this.setFocusPlanet(this.focusPlanetId);

    this.cameraRig = {
      camera: this.camera,
      update: (dt, _metrics, orbitInput) => {
        this._updateCamera(dt, orbitInput);
      },
    };
  }

  dispose(){
    if (this.scene && this.root){
      this.scene.remove(this.root);
    }
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
    this._updateZoom(dt, zoomDelta, planet);

    const orbitDelta = dt * planet.orbitAngularSpeed;
    planet.pivot.rotation.y += orbitDelta;
    planet.mesh.rotation.y += dt * planet.spinSpeed;

    this._updateMetrics(planet);
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

  _updateZoom(dt, zoomDelta, planet){
    if (Number.isFinite(zoomDelta) && zoomDelta !== 0){
      const step = zoomDelta * this.zoomSpeed;
      this.targetCameraDistance = THREE.MathUtils.clamp(
        this.targetCameraDistance - step,
        this.minDistance,
        this.maxDistance,
      );
    }
    const blend = dt > 0 ? 1 - Math.exp(-DISTANCE_BLEND_RATE * dt) : 1;
    this.cameraDistance += (this.targetCameraDistance - this.cameraDistance) * blend;
    this.zoomNormalized = this._computeZoomNormalized();
  }

  _computeZoomNormalized(){
    if (!Number.isFinite(this.minDistance) || !Number.isFinite(this.maxDistance)) return 0;
    if (this.maxDistance <= this.minDistance) return 0;
    const ratio = (this.cameraDistance - this.minDistance) / (this.maxDistance - this.minDistance);
    return THREE.MathUtils.clamp(ratio, 0, 1);
  }

  _updateCamera(dt, orbitInput){
    const planet = this.planets.get(this.focusPlanetId);
    if (!planet || !this.camera) return;

    const input = orbitInput ?? this.lastOrbitInput ?? {};
    const yawDelta = input?.yawDelta ?? 0;
    const pitchDelta = input?.pitchDelta ?? 0;
    const active = input?.active ?? this.lastInputOrbitActive ?? false;

    if (active){
      this.orbitAngles.yaw += yawDelta;
      this.orbitAngles.pitch += pitchDelta;
    } else {
      this.orbitAngles.yaw += yawDelta * 0.5;
      this.orbitAngles.pitch += pitchDelta * 0.5;
      if (this.autoOrbitEnabled){
        this.orbitAngles.yaw += this.autoOrbitSpeed * (dt || 0);
      }
    }

    this.orbitAngles.pitch = THREE.MathUtils.clamp(this.orbitAngles.pitch, -Math.PI / 2 + 0.14, Math.PI / 2 - 0.14);

    const worldTarget = planet.mesh.getWorldPosition(this.cameraTarget);
    const distance = Math.max(this.cameraDistance, planet.radius * 1.2);
    const phi = Math.PI / 2 - this.orbitAngles.pitch;
    const theta = this.orbitAngles.yaw;
    TMP_SPHERICAL.set(distance, phi, theta);
    this.cameraPosition.setFromSpherical(TMP_SPHERICAL).add(worldTarget);

    if (dt > 0){
      const blend = 1 - Math.exp(-CAMERA_BLEND_RATE * dt);
      this.camera.position.lerp(this.cameraPosition, blend);
    } else {
      this.camera.position.copy(this.cameraPosition);
    }
    this.camera.lookAt(worldTarget);
    this.camera.up.set(0, 1, 0);
  }

  _updateDistanceBounds(planet){
    const base = Math.max(planet.radius * 2.6, 1200);
    const orbitInfluence = Math.max(planet.orbitDistance * 0.12, 0);
    this.minDistance = base + orbitInfluence * 0.18;
    this.maxDistance = Math.max(this.minDistance * 4.5, base * 6.8, planet.orbitDistance * 1.4 + base * 1.8);

    const preferred = Math.max(
      this.minDistance * 1.8,
      base * 1.65,
      planet.radius * 5.2 + orbitInfluence * 0.55,
    );
    const clampedTarget = THREE.MathUtils.clamp(preferred, this.minDistance * 1.1, this.maxDistance * 0.9);

    this.targetCameraDistance = clampedTarget;
    this.cameraDistance = clampedTarget;
    this.zoomNormalized = this._computeZoomNormalized();
  }

  _updateMetrics(planet){
    const thresholds = this._computeThresholds(planet);
    const altitude = Math.max(0, this.cameraDistance - planet.radius);
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
