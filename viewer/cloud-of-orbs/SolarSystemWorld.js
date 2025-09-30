import { requireTHREE } from '../shared/threeSetup.js';
import { PLANETS_IN_RENDER_ORDER } from './planets/index.js';
import { disposeSharedMaterials } from './planets/sharedMaterials.js';

const TWO_PI = Math.PI * 2;
const DEFAULT_ORBIT_SCALE = 420;
const DEFAULT_TIME_SCALE = 1 / 120; // Seconds -> Earth years conversion.

function isFiniteNumber(value){
  return typeof value === 'number' && Number.isFinite(value);
}

function toRadians(degrees){
  return degrees * (Math.PI / 180);
}

function resolveThreshold(distance, thresholds = {}){
  if (!isFiniteNumber(distance)){
    return {
      level: 'unknown',
      nextThreshold: null,
      nextThresholdDistance: null,
      distanceToNextThreshold: null,
      withinDetailRange: false,
    };
  }

  const sorted = Object.entries(thresholds)
    .filter(([, value]) => isFiniteNumber(value))
    .sort((a, b) => a[1] - b[1]);

  if (!sorted.length){
    return {
      level: 'unknown',
      nextThreshold: null,
      nextThresholdDistance: null,
      distanceToNextThreshold: null,
      withinDetailRange: false,
    };
  }

  let currentLevel = 'distant';
  let nextThreshold = sorted[0][0];
  let nextThresholdDistance = sorted[0][1];

  for (let i = 0; i < sorted.length; i += 1){
    const [label, value] = sorted[i];
    if (distance <= value){
      currentLevel = label;
      nextThreshold = label;
      nextThresholdDistance = value;
      break;
    }
    currentLevel = 'distant';
    nextThreshold = sorted[i + 1]?.[0] ?? null;
    nextThresholdDistance = sorted[i + 1]?.[1] ?? null;
  }

  const detailThreshold = isFiniteNumber(thresholds.high)
    ? thresholds.high
    : sorted[sorted.length - 1][1];
  const withinDetailRange = distance <= detailThreshold;

  const distanceToNextThreshold = isFiniteNumber(nextThresholdDistance)
    ? nextThresholdDistance - distance
    : null;

  return {
    level: currentLevel,
    nextThreshold,
    nextThresholdDistance,
    distanceToNextThreshold,
    withinDetailRange,
  };
}

function createDeterministicRng(seed = 1337){
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export class SolarSystemWorld {
  constructor({
    scene = null,
    orbitScale = DEFAULT_ORBIT_SCALE,
    timeScale = DEFAULT_TIME_SCALE,
    enableStarfield = true,
    starfield = {},
    rngSeed = 0x5f3759df,
  } = {}){
    this.THREE = requireTHREE();
    this.scene = scene;
    this.orbitScale = orbitScale;
    this.timeScale = timeScale;
    this.enableStarfield = enableStarfield;
    this.originOffset = new this.THREE.Vector3();
    this.group = new this.THREE.Group();
    this.group.name = 'SolarSystemWorld';

    this.planetStates = new Map();
    this.sharedMaterials = new Set();
    this._geometryDisposables = new Set();
    this._ownedMaterials = new Set();
    this._lights = [];

    this._observerLocalPosition = new this.THREE.Vector3();
    this._observerWorldPosition = new this.THREE.Vector3();
    this._observerHasPosition = false;
    this._lastProximity = null;

    this._rng = createDeterministicRng(rngSeed);

    if (this.scene){
      this.scene.add(this.group);
    }

    this._createPlanets();
    this._createLighting();
    if (this.enableStarfield){
      this._createStarfield(starfield);
    }

    // Position meshes once so downstream queries immediately work.
    this.update(0);
  }

  update(dt = 0, observerPosition = undefined){
    const deltaSeconds = isFiniteNumber(dt) ? dt : 0;
    const deltaYears = deltaSeconds * this.timeScale;

    if (observerPosition !== undefined){
      if (observerPosition === null){
        this.clearObserverPosition();
      } else {
        this.setObserverPosition(observerPosition);
      }
    }

    const hasObserver = this._observerHasPosition;
    if (hasObserver){
      this._observerWorldPosition.copy(this._observerLocalPosition).add(this.originOffset);
    }

    let nearestState = null;
    let nearestDistance = Infinity;

    this.planetStates.forEach((state) => {
      this._advancePlanet(state, deltaYears);
      if (hasObserver){
        const distance = state.worldPosition.distanceTo(this._observerWorldPosition);
        state.lastDistanceToObserver = distance;
        if (distance < nearestDistance){
          nearestDistance = distance;
          nearestState = state;
        }
      } else {
        state.lastDistanceToObserver = null;
      }
    });

    if (this.starfield){
      this.starfield.position.set(-this.originOffset.x, -this.originOffset.y, -this.originOffset.z);
    }

    if (nearestState){
      this._lastProximity = this._buildProximityMetrics(nearestState, nearestDistance);
      return this._cloneProximity(this._lastProximity);
    }

    this._lastProximity = null;
    return null;
  }

  handleOriginShift(shift){
    if (!shift) return;
    this.originOffset.add(shift);
    this.planetStates.forEach((state) => {
      state.localPosition.copy(state.worldPosition).sub(this.originOffset);
      state.mesh.position.copy(state.localPosition);
    });
    if (this.starfield){
      this.starfield.position.set(-this.originOffset.x, -this.originOffset.y, -this.originOffset.z);
    }
    if (this._observerHasPosition){
      this._observerWorldPosition.copy(this._observerLocalPosition).add(this.originOffset);
    }
  }

  setObserverPosition(position){
    if (!position){
      this.clearObserverPosition();
      return;
    }
    this._observerLocalPosition.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
    this._observerHasPosition = true;
  }

  clearObserverPosition(){
    this._observerHasPosition = false;
    this._observerLocalPosition.set(0, 0, 0);
    this._observerWorldPosition.set(0, 0, 0);
  }

  getPlanetShell(id){
    return this.planetStates.get(id)?.mesh ?? null;
  }

  getNearestPlanet(position = undefined){
    if (position === undefined){
      return this._lastProximity ? this._cloneProximity(this._lastProximity) : null;
    }
    if (!position){
      return null;
    }
    const worldPosition = this._scratchWorldPosition ?? new this.THREE.Vector3();
    if (!this._scratchWorldPosition){
      this._scratchWorldPosition = worldPosition;
    }
    worldPosition.set(position.x ?? 0, position.y ?? 0, position.z ?? 0).add(this.originOffset);

    let nearestState = null;
    let nearestDistance = Infinity;
    this.planetStates.forEach((state) => {
      const distance = state.worldPosition.distanceTo(worldPosition);
      if (distance < nearestDistance){
        nearestDistance = distance;
        nearestState = state;
      }
    });

    return nearestState ? this._buildProximityMetrics(nearestState, nearestDistance) : null;
  }

  dispose(){
    this.planetStates.forEach((state) => {
      if (state.mesh?.parent === this.group){
        this.group.remove(state.mesh);
      }
    });
    this.planetStates.clear();

    this._lights.forEach((light) => {
      if (light?.parent){
        light.parent.remove(light);
      }
    });
    this._lights = [];
    this._sunLight = null;

    if (this.starfield?.parent){
      this.starfield.parent.remove(this.starfield);
    }
    this.starfield = null;

    if (this.scene){
      this.scene.remove(this.group);
    }
    this.group.clear?.();

    this._geometryDisposables.forEach((geometry) => {
      geometry?.dispose?.();
    });
    this._geometryDisposables.clear();

    this._ownedMaterials.forEach((material) => {
      material?.dispose?.();
    });
    this._ownedMaterials.clear();

    disposeSharedMaterials();
    this.sharedMaterials.clear();
  }

  _createPlanets(){
    const total = PLANETS_IN_RENDER_ORDER.length;
    PLANETS_IN_RENDER_ORDER.forEach((module, index) => {
      const metadata = module.metadata ?? {};
      const createMesh = typeof module.createOrbitalMesh === 'function'
        ? module.createOrbitalMesh
        : null;
      if (!createMesh) return;

      const mesh = createMesh();
      if (!mesh) return;

      mesh.castShadow = mesh.castShadow ?? (metadata.id !== 'sun');
      mesh.receiveShadow = mesh.receiveShadow ?? false;
      mesh.userData = { ...mesh.userData, planetId: metadata.id };

      this._registerPlanetMesh(mesh);

      const angularVelocity = isFiniteNumber(metadata.angularVelocity)
        ? metadata.angularVelocity
        : 0;
      const inclination = toRadians(isFiniteNumber(metadata.inclination) ? metadata.inclination : 0);
      const orbitDistance = isFiniteNumber(metadata.orbitDistance) ? metadata.orbitDistance : 0;

      const defaultPhase = (index / Math.max(1, total)) * Math.PI * 0.65;
      const initialAngle = isFiniteNumber(metadata.phaseOffset)
        ? metadata.phaseOffset
        : isFiniteNumber(metadata.initialAngle)
          ? metadata.initialAngle
          : defaultPhase;

      const state = {
        id: metadata.id ?? `body-${index}`,
        metadata,
        module,
        mesh,
        angularVelocity,
        inclination,
        orbitRadius: orbitDistance * this.orbitScale,
        angle: initialAngle,
        worldPosition: new this.THREE.Vector3(),
        localPosition: new this.THREE.Vector3(),
        lastDistanceToObserver: null,
      };

      mesh.userData.orbitalState = state;

      this.planetStates.set(state.id, state);
      this.group.add(mesh);
    });
  }

  _advancePlanet(state, deltaYears){
    if (!state) return;

    if (isFiniteNumber(deltaYears) && deltaYears !== 0){
      state.angle = (state.angle + state.angularVelocity * deltaYears) % TWO_PI;
      if (state.angle < 0) state.angle += TWO_PI;
    }

    const radius = isFiniteNumber(state.orbitRadius) ? state.orbitRadius : 0;
    const cos = Math.cos(state.angle);
    const sin = Math.sin(state.angle);

    const worldX = cos * radius;
    const planarY = sin * radius;

    if (state.inclination !== 0){
      const cosInc = Math.cos(state.inclination);
      const sinInc = Math.sin(state.inclination);
      state.worldPosition.set(worldX, planarY * cosInc, planarY * sinInc);
    } else {
      state.worldPosition.set(worldX, planarY, 0);
    }

    state.localPosition.copy(state.worldPosition).sub(this.originOffset);
    state.mesh.position.copy(state.localPosition);

    if (state.id === 'sun' && this._sunLight){
      this._sunLight.position.copy(state.localPosition);
    }
  }

  _createLighting(){
    const ambient = new this.THREE.AmbientLight(0xffffff, 0.2);
    ambient.name = 'SolarAmbientLight';
    this.group.add(ambient);
    this._lights.push(ambient);

    const sunState = this.planetStates.get('sun');
    const sunLight = new this.THREE.PointLight(0xfff2d6, 2.25, 0, 2);
    sunLight.name = 'SolarKeyLight';
    sunLight.castShadow = false;
    sunLight.position.set(0, 0, 0);
    if (sunState){
      sunLight.position.copy(sunState.localPosition);
    }
    this.group.add(sunLight);
    this._lights.push(sunLight);
    this._sunLight = sunLight;
  }

  _createStarfield({ count = 2000, radius = this.orbitScale * 50, size = 2, opacity = 0.85 } = {}){
    const geom = new this.THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const rng = this._rng;

    for (let i = 0; i < count; i += 1){
      const u = rng();
      const v = rng();
      const theta = TWO_PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = radius;
      positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }

    geom.setAttribute('position', new this.THREE.BufferAttribute(positions, 3));
    const material = new this.THREE.PointsMaterial({
      size,
      sizeAttenuation: true,
      color: 0xffffff,
      transparent: true,
      opacity,
    });

    const points = new this.THREE.Points(geom, material);
    points.name = 'SolarSystemStarfield';
    points.renderOrder = -20;

    this.group.add(points);
    this.starfield = points;

    this._geometryDisposables.add(geom);
    this._ownedMaterials.add(material);
  }

  _registerPlanetMesh(mesh){
    if (!mesh) return;
    if (mesh.geometry){
      this._geometryDisposables.add(mesh.geometry);
    }
    if (mesh.material){
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => this.sharedMaterials.add(material));
    }
  }

  _buildProximityMetrics(state, distance){
    if (!state) return null;
    const thresholds = state.metadata?.loadThresholds ?? null;
    const info = thresholds ? resolveThreshold(distance, thresholds) : {
      level: 'unknown',
      nextThreshold: null,
      nextThresholdDistance: null,
      distanceToNextThreshold: null,
      withinDetailRange: false,
    };

    return {
      id: state.id,
      label: state.metadata?.label ?? state.id,
      metadata: state.metadata,
      shell: state.mesh,
      distance,
      thresholdLevel: info.level,
      thresholds,
      nextThreshold: info.nextThreshold,
      nextThresholdDistance: info.nextThresholdDistance,
      distanceToNextThreshold: info.distanceToNextThreshold,
      withinDetailRange: info.withinDetailRange,
      worldPosition: state.worldPosition.clone(),
      localPosition: state.localPosition.clone(),
    };
  }

  _cloneProximity(proximity){
    if (!proximity) return null;
    return {
      ...proximity,
      worldPosition: proximity.worldPosition.clone(),
      localPosition: proximity.localPosition.clone(),
    };
  }
}

export default SolarSystemWorld;
