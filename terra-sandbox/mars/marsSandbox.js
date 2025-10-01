import { THREE } from './threeLoader.js';

import { MarsPlaneController, createShipMesh } from './PlaneController.js';

import { MarsVehicle, createMarsSkiff } from './vehicle.js';

import { MarsChaseCamera } from './chaseCamera.js';
import { MarsInputManager } from './input.js';
import { MarsProjectileSystem } from './projectiles.js';
import { MarsHUD } from './hud.js';
import { MarsCaveTerrainManager } from './caveTerrain.js';

function createMulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MarsSandbox {
  constructor({
    canvas,
    statusLabel,
    altitudeOutput,
    temperatureOutput,
    windOutput,
    speedOutput,
    throttleOutput,
    weaponOutput,
    seedOutput,
    minimapCanvas,
    beaconList,
  }) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.surfaceGroup = null;
    this.terrain = null;
    this.seed = null;
    this.rng = null;

    this.vehicle = null;
    this.vehicleMesh = null;
    this.chaseCamera = null;
    this.inputManager = null;
    this.projectiles = null;
    this.hud = new MarsHUD({
      statusLabel,
      altitudeOutput,
      temperatureOutput,
      windOutput,
      speedOutput,
      throttleOutput,
      weaponOutput,
      seedOutput,
      minimapCanvas,
      beaconList,
    });

    this.animationHandle = null;
    this.weaponColor = new THREE.Color('#ff9d5c');

    this.beacons = [];
    this.beaconGroup = null;
    this.chunkAccents = new Map();
    this.chunkAccentGroup = null;
    this.exploredChunks = new Map();
    this.minimapDirty = true;
    this._minimapTimer = 0;
    this.ambientAudio = null;
    this.audioListener = null;
    this.ambientLevel = 0.18;
    this.ambientTarget = 0.18;
    this.droneLight = null;

    this._handleChunkActivated = this._handleChunkActivated.bind(this);
    this._handleChunkDeactivated = this._handleChunkDeactivated.bind(this);

    this._handleResize = this._handleResize.bind(this);
    this._update = this._update.bind(this);
  }

  initialize(seed) {
    this.seed = typeof seed === 'number' ? seed : this._generateSeed();
    this.rng = createMulberry32(this.seed);
    this.hud.setSeed(this.seed.toString(16).toUpperCase());

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: true,
      powerPreference: 'low-power',
    });
    const rendererPixelRatio = Math.min(1, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(rendererPixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = false;
    this.renderer.useLegacyLights = false;

    this.scene = new THREE.Scene();
    const fogColor = new THREE.Color('#080512');
    this.scene.background = fogColor.clone();
    this.scene.fog = new THREE.FogExp2(fogColor, 0.00065);

    const aspect = this.canvas.clientWidth / this.canvas.clientHeight || window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.1, 3600);

    const ambient = new THREE.HemisphereLight('#4d3a63', '#12060f', 0.68);
    this.scene.add(ambient);
    const fillLight = new THREE.AmbientLight('#1f1326', 0.42);
    this.scene.add(fillLight);

    this.surfaceGroup = new THREE.Group();
    this.scene.add(this.surfaceGroup);

    this.chunkAccentGroup = new THREE.Group();
    this.chunkAccentGroup.name = 'marsChunkAccents';
    this.scene.add(this.chunkAccentGroup);

    this.beaconGroup = new THREE.Group();
    this.beaconGroup.name = 'navigationBeacons';
    this.scene.add(this.beaconGroup);

    this._buildTerrain();

    this._setupAudio();

    this.vehicle = new MarsPlaneController();
    const shipMesh = createShipMesh();
    this.vehicle.attachMesh(shipMesh);
    this.vehicle.setAuxiliaryLightsActive(false);
    this._attachDroneLight(shipMesh);
    this.scene.add(shipMesh);
    this.vehicleMesh = shipMesh;

    const spawn = this._getSpawnTransform();
    this.vehicle.reset(spawn);
    this.terrain?.updateChunks?.(spawn?.position ?? this.vehicle.position);
    this.minimapDirty = true;
    this._minimapTimer = 0;

    this.chaseCamera = new MarsChaseCamera({
      camera: this.camera,
      distance: 64,
      height: 24,
      lookAhead: 40,
      responsiveness: 5.8,
      rollFollow: true,
      rollResponsiveness: 6.5,
    });
    this.chaseCamera.follow(this.vehicle);

    this.projectiles = new MarsProjectileSystem({ scene: this.scene });
    this.inputManager = new MarsInputManager({ canvas: this.canvas });

    this.hud.setStatus('Atmospheric surveyor plane systems nominal. Weapons hot.');
    this._updateWeather();
    this._handleResize();
    window.addEventListener('resize', this._handleResize);
  }

  start() {
    if (!this.renderer) {
      throw new Error('MarsSandbox not initialized');
    }
    if (this.animationHandle) return;
    this.clock.start();
    this.animationHandle = this.renderer.setAnimationLoop(this._update);
  }

  stop() {
    if (this.animationHandle) {
      this.renderer.setAnimationLoop(null);
      this.animationHandle = null;
    }
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._handleResize);
    this.inputManager?.dispose?.();
    this.projectiles?.dispose?.();
    this.projectiles = null;
    this._clearBeacons({ silent: true });
    this._disposeChunkAccents();
    this._disposeAudio();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    this.terrain?.dispose?.();
    this.terrain = null;
    this.scene = null;
  }

  resetCamera() {
    this.chaseCamera?.snap?.();
    this.hud.setStatus('Camera anchor reset.');
  }

  resetVehicle() {
    if (!this.vehicle) return;
    const spawn = this._getSpawnTransform();
    this.vehicle.reset(spawn);
    this.chaseCamera?.snap?.();
    this.terrain?.updateChunks?.(spawn?.position ?? this.vehicle.position);
    this.hud.setStatus('Surveyor plane repositioned at orbit anchor.');
    this.minimapDirty = true;
    this._minimapTimer = 0;
  }

  regenerate(seed) {
    const nextSeed = typeof seed === 'number' ? seed : this._generateSeed();
    this.seed = nextSeed;
    this.rng = createMulberry32(this.seed);
    this.hud.setSeed(this.seed.toString(16).toUpperCase());
    this._clearBeacons({ silent: true });
    this._buildTerrain();
    const spawn = this._getSpawnTransform();
    this.vehicle?.reset(spawn);
    this.chaseCamera?.snap?.();
    const focus = spawn?.position ?? this.vehicle?.position ?? new THREE.Vector3();
    this.terrain?.updateChunks?.(focus);
    this._updateWeather();
    this.hud.setStatus('Terrain regenerated. Navigation recalibrated.');
    this.minimapDirty = true;
    this._minimapTimer = 0;
  }

  _buildTerrain() {
    if (this.surfaceGroup && this.surfaceGroup.children.length > 0) {
      for (const child of [...this.surfaceGroup.children]) {
        this.surfaceGroup.remove(child);
      }
    }
    if (this.terrain) {
      this.terrain.setLifecycleHandlers();
      this.terrain.dispose?.();
      this.terrain = null;
    }
    this._disposeChunkAccents();
    this.exploredChunks.clear();
    this.minimapDirty = true;
    this.terrain = new MarsCaveTerrainManager({
      seed: this.seed,
      chunkSize: 18,
      resolution: 8,
      threshold: 0,
      horizontalRadius: 3,
      verticalRadius: 2,
    });
    this.terrain.setLifecycleHandlers({
      onChunkActivated: this._handleChunkActivated,
      onChunkDeactivated: this._handleChunkDeactivated,
    });
    this.surfaceGroup.add(this.terrain.group);
    this._updateAmbientTarget();
  }

  _updateWeather() {
    if (!this.rng) return;
    const temperature = -70 + this.rng() * 35;
    const gust = 6 + this.rng() * 26;
    this.hud.updateEnvironment({ temperature, wind: gust });
  }

  _handleResize() {
    if (!this.renderer || !this.camera) return;
    const width = this.canvas.clientWidth || window.innerWidth - 340;
    const height = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(1.25, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  _update() {
    const dt = this.clock.getDelta();
    if (!this.vehicle || !this.scene) return;

    this.inputManager?.update?.(dt);
    const inputState = this.inputManager ? this.inputManager.getState() : {};

    if (inputState.toggleNavigationLights) {
      const next = !this.vehicle.areNavigationLightsEnabled();
      this.vehicle.setNavigationLightsEnabled(next);
      this.hud.setStatus(next ? 'Navigation beacons illuminated.' : 'Navigation beacons darkened.');
    }
    if (inputState.toggleAuxiliaryLights) {
      const next = !this.vehicle.auxiliaryLightsEnabled;
      this.vehicle.setAuxiliaryLightsActive(next);
      this.hud.setStatus(next ? 'Auxiliary landing lights engaged.' : 'Auxiliary landing lights offline.');
    }

    const adjustAuxiliaryLights = (delta) => {
      if (!this.vehicle?.adjustAuxiliaryLightLevel) return;
      const nextLevel = this.vehicle.adjustAuxiliaryLightLevel(delta);
      const enabled = this.vehicle.auxiliaryLightsEnabled && nextLevel > 0;
      if (!enabled) {
        this.hud.setStatus('Auxiliary landing lights offline.');
      } else {
        const percent = Math.round(nextLevel * 100);
        this.hud.setStatus(`Auxiliary lighting output at ${percent}%.`);
      }
    };

    if (inputState.increaseAuxiliaryLights) {
      adjustAuxiliaryLights(0.1);
    }
    if (inputState.decreaseAuxiliaryLights) {
      adjustAuxiliaryLights(-0.1);
    }

    if (inputState.dropBeacon) {
      this._deployBeacon();
    }
    if (inputState.clearBeacons) {
      this._clearBeacons();
    }

    const volumeQuery = this.terrain?.queryVolume
      ? (position, options) => this.terrain.queryVolume(position, options)
      : null;

    this.vehicle.update(dt, inputState, {
      queryVolume: volumeQuery,
      collisionRadius: 8.4,
      clearance: { floor: 14, ceiling: 10, lateral: 9.5 },
    });

    this.terrain?.updateChunks?.(this.vehicle.position);

    if (inputState.firing) {
      const shot = this.vehicle.firePrimary();
      if (shot) {
        this.projectiles.fire({ origin: shot.origin, direction: shot.direction, velocity: shot.velocity, life: 4.5, color: this.weaponColor });
      }
    }

    this.projectiles?.update?.(dt);
    this.chaseCamera?.update?.(dt);

    const vehicleState = this.vehicle.getState(volumeQuery);
    const speedKmh = vehicleState.speed * 3.6;
    this.hud.updateVehicle({
      altitude: vehicleState.altitude,
      speed: speedKmh,
      throttle: vehicleState.throttle,
      boost: vehicleState.boost,
      weaponReady: vehicleState.weapon.ready,
      heat: vehicleState.weapon.heat,
    });

    const elapsed = this.clock.elapsedTime;
    this._animateChunkAccents(elapsed);
    this._animateBeacons(elapsed);
    this._updateAmbientAudio(dt);

    const navigationBeacons = this.beacons.map((beacon, index) => {
      const { x, y, z } = beacon.mesh.position;
      return {
        index: index + 1,
        position: { x, y, z },
        distance: beacon.mesh.position.distanceTo(this.vehicle.position),
      };
    });
    this._minimapTimer = Math.max(0, this._minimapTimer - dt);
    const redrawMinimap = this.minimapDirty || this._minimapTimer <= 0;
    this.hud.updateNavigation({
      vehiclePosition: { x: this.vehicle.position.x, y: this.vehicle.position.y, z: this.vehicle.position.z },
      beacons: navigationBeacons,
      exploredChunks: Array.from(this.exploredChunks.values()),
      chunkSize: this.terrain?.chunkSize ?? 16,
    });
    if (redrawMinimap) {
      this._minimapTimer = 0.2;
      this.minimapDirty = false;
    }

    if (this.terrain?.dustField) {
      const material = this.terrain.dustField.material;
      material.opacity = 0.6 + Math.sin(elapsed * 0.8) * 0.08;
      const geometry = this.terrain.dustField.geometry;
      const positions = geometry.attributes.position;
      const baseY = geometry.attributes.baseY;
      for (let i = 0; i < positions.count; i += 1) {
        const yIndex = i * 3 + 1;
        const wave = Math.sin(elapsed * 0.6 + i * 0.25) * 0.65;
        positions.array[yIndex] = baseY.array[i] + wave;
      }
      positions.needsUpdate = true;
    }

    this.renderer.render(this.scene, this.camera);
  }

  _attachDroneLight(mesh) {
    if (!mesh) return;
    if (this.droneLight) {
      mesh.add(this.droneLight);
      mesh.add(this.droneLight.target);
      return;
    }
    const light = new THREE.SpotLight('#ffd7a4', 4.5, 220, THREE.MathUtils.degToRad(44), 0.38, 1.55);
    light.castShadow = false;
    light.name = 'droneSpotlight';
    light.position.set(0, 7.5, 2.8);
    light.penumbra = 0.52;
    const target = light.target;
    target.position.set(0, 22, -10);
    mesh.add(light);
    mesh.add(target);
    this.droneLight = light;
  }

  _setupAudio() {
    if (!this.camera || this.audioListener) return;
    try {
      this.audioListener = new THREE.AudioListener();
      this.camera.add(this.audioListener);
      const ambience = new THREE.Audio(this.audioListener);
      const { context } = this.audioListener;
      const sampleRate = context.sampleRate || 44100;
      const duration = 2.4;
      const buffer = context.createBuffer(1, Math.floor(sampleRate * duration), sampleRate);
      const channel = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < channel.length; i += 1) {
        const noise = Math.random() * 2 - 1;
        last = last * 0.985 + noise * 0.015;
        channel[i] = last * 0.42;
      }
      ambience.setBuffer(buffer);
      ambience.setLoop(true);
      ambience.setVolume(this.ambientLevel);
      ambience.play();
      this.ambientAudio = ambience;
      this.ambientTarget = this.ambientLevel;
    } catch (error) {
      console.warn('Unable to initialize ambient audio', error);
    }
  }

  _disposeAudio() {
    if (this.ambientAudio) {
      try {
        this.ambientAudio.stop();
      } catch (error) {
        // ignore stop errors
      }
      this.ambientAudio.disconnect?.();
      this.ambientAudio = null;
    }
    if (this.audioListener && this.camera) {
      this.camera.remove(this.audioListener);
    }
    this.audioListener = null;
    this.ambientLevel = 0.18;
    this.ambientTarget = 0.18;
  }

  _updateAmbientAudio(dt) {
    if (!this.ambientAudio) return;
    const blend = dt > 0 ? 1 - Math.exp(-0.9 * dt) : 1;
    this.ambientLevel += (this.ambientTarget - this.ambientLevel) * blend;
    this.ambientLevel = THREE.MathUtils.clamp(this.ambientLevel, 0.05, 1.2);
    this.ambientAudio.setVolume(this.ambientLevel);
  }

  _updateAmbientTarget() {
    if (!this.terrain) {
      this.ambientTarget = 0.18;
      return;
    }
    let sum = 0;
    let count = 0;
    for (const metadata of this.terrain.chunkMetadata.values()) {
      if (!metadata) continue;
      sum += Math.abs(metadata.hazards ?? 0);
      count += 1;
    }
    const hazard = count > 0 ? sum / count : 0;
    const offset = THREE.MathUtils.clamp(hazard * 0.35, 0, 0.6);
    this.ambientTarget = 0.16 + offset;
  }

  _handleChunkActivated({ key, coord, metadata }) {
    if (!coord) return;
    const centerVec = this.terrain?.getChunkCenter?.(coord);
    const center = centerVec
      ? { x: centerVec.x, y: centerVec.y, z: centerVec.z }
      : {
          x: coord.x * (this.terrain?.chunkSize ?? 16),
          y: coord.y * (this.terrain?.chunkSize ?? 16),
          z: coord.z * (this.terrain?.chunkSize ?? 16),
        };
    this.exploredChunks.set(key, { key, coord, center, metadata });
    this._spawnChunkAccents(key, coord, metadata);
    this._updateAmbientTarget();
    this.minimapDirty = true;
  }

  _handleChunkDeactivated({ key }) {
    if (!key) return;
    this._removeChunkAccent(key);
    this._updateAmbientTarget();
    this.minimapDirty = true;
  }

  _spawnChunkAccents(key, coord, metadata) {
    if (!this.chunkAccentGroup || this.chunkAccents.has(key)) return;
    const chunkSize = this.terrain?.chunkSize ?? 16;
    const centerVec = this.terrain?.getChunkCenter?.(coord);
    const baseCenter = centerVec ? centerVec.clone() : new THREE.Vector3(
      coord.x * chunkSize + chunkSize * 0.5,
      coord.y * chunkSize + chunkSize * 0.5,
      chunkSize * 0.5,
    );
    const hazard = Math.abs(metadata?.hazards ?? 0);
    const resources = Array.isArray(metadata?.resources) && metadata.resources.length > 0
      ? metadata.resources
      : [{ type: metadata?.biome ?? 'ember', offset: [0, 0, 0] }];

    const group = new THREE.Group();
    group.name = `chunkAccent:${key}`;
    const crystals = [];
    const biome = metadata?.biome ?? 'ember';
    const biomeColors = {
      lumenite: '#63f0ff',
      siltstone: '#ffbe73',
      ember: '#ff6a3c',
    };

    for (let i = 0; i < resources.length; i += 1) {
      const resource = resources[i];
      const offset = Array.isArray(resource?.offset) ? resource.offset : [0, 0, 0];
      const position = baseCenter.clone();
      position.x += offset[0] * chunkSize * 0.6;
      position.y += offset[1] * chunkSize * 0.6;
      position.z += offset[2] * chunkSize * 0.5 + 4 + i * 1.8;

      const colorHex = resource?.type === 'crystalCluster'
        ? '#68f6ff'
        : resource?.type === 'mineralPocket'
          ? '#ffd37a'
          : biomeColors[biome] ?? '#ff6a3c';
      const color = new THREE.Color(colorHex);

      const geometry = new THREE.OctahedronGeometry(2.4, 0);
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#12070d'),
        emissive: color,
        emissiveIntensity: 1.15 + hazard * 0.4,
        roughness: 0.35,
        metalness: 0.12,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);
      mesh.scale.setScalar(1.3 + hazard * 0.35);
      group.add(mesh);

      const light = new THREE.PointLight(color, 3 + hazard * 1.4, 90 + hazard * 42, 2.1);
      light.position.copy(position);
      group.add(light);

      crystals.push({
        mesh,
        light,
        baseIntensity: light.intensity,
        baseEmissive: material.emissiveIntensity,
        phase: Math.random() * Math.PI * 2,
      });
    }

    this.chunkAccentGroup.add(group);
    this.chunkAccents.set(key, { group, crystals });
  }

  _removeChunkAccent(key) {
    const accent = this.chunkAccents.get(key);
    if (!accent) return;
    if (accent.group && this.chunkAccentGroup) {
      this.chunkAccentGroup.remove(accent.group);
    }
    if (accent.crystals) {
      for (const crystal of accent.crystals) {
        crystal.mesh?.geometry?.dispose?.();
        crystal.mesh?.material?.dispose?.();
      }
    }
    this.chunkAccents.delete(key);
  }

  _disposeChunkAccents() {
    for (const key of [...this.chunkAccents.keys()]) {
      this._removeChunkAccent(key);
    }
  }

  _animateChunkAccents(elapsed) {
    for (const accent of this.chunkAccents.values()) {
      if (!accent?.crystals) continue;
      for (const crystal of accent.crystals) {
        const pulse = 0.65 + Math.sin(elapsed * 0.55 + crystal.phase) * 0.35;
        if (crystal.light) {
          crystal.light.intensity = crystal.baseIntensity * THREE.MathUtils.clamp(pulse, 0.3, 1.6);
        }
        if (crystal.mesh?.material) {
          crystal.mesh.material.emissiveIntensity = crystal.baseEmissive * (0.6 + pulse * 0.45);
        }
      }
    }
  }

  _deployBeacon() {
    if (!this.vehicle || !this.beaconGroup) return;
    const beaconPosition = this.vehicle.position.clone();
    const geometry = new THREE.IcosahedronGeometry(1.1, 0);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#0e2433'),
      emissive: new THREE.Color('#58e0ff'),
      emissiveIntensity: 1.4,
      roughness: 0.32,
      metalness: 0.18,
      transparent: true,
      opacity: 0.95,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(beaconPosition);
    mesh.position.z -= 2.5;
    const beaconVolume = this.terrain?.queryVolume?.(mesh.position, { radius: 0 });
    if (Number.isFinite(beaconVolume?.floor)) {
      mesh.position.z = Math.max(mesh.position.z, beaconVolume.floor + 1.5);
    }
    mesh.castShadow = false;
    this.beaconGroup.add(mesh);

    const light = new THREE.PointLight('#58e0ff', 2.4, 120, 2.4);
    light.position.copy(mesh.position);
    this.beaconGroup.add(light);

    const beacon = {
      mesh,
      light,
      baseIntensity: light.intensity,
      phase: Math.random() * Math.PI * 2,
    };
    this.beacons.push(beacon);
    while (this.beacons.length > 5) {
      const removed = this.beacons.shift();
      if (removed) {
        this.beaconGroup.remove(removed.mesh);
        this.beaconGroup.remove(removed.light);
        removed.mesh.geometry?.dispose?.();
        removed.mesh.material?.dispose?.();
      }
    }
    this.minimapDirty = true;
    this._minimapTimer = 0;
    this.hud.setStatus('Navigation beacon deployed.');
  }

  _animateBeacons(elapsed) {
    for (const beacon of this.beacons) {
      const pulse = 0.75 + Math.sin(elapsed * 1.8 + beacon.phase) * 0.25;
      if (beacon.light) {
        beacon.light.intensity = beacon.baseIntensity * THREE.MathUtils.clamp(pulse, 0.4, 1.5);
      }
      if (beacon.mesh?.material) {
        beacon.mesh.material.emissiveIntensity = 1.1 + pulse * 0.6;
        beacon.mesh.rotation.y = elapsed * 0.6 + beacon.phase;
        beacon.mesh.rotation.x = Math.sin(elapsed * 0.4 + beacon.phase) * 0.2;
      }
      if (beacon.light) {
        beacon.light.position.copy(beacon.mesh.position);
      }
    }
  }

  _clearBeacons({ silent = false } = {}) {
    if (this.beacons.length === 0) return;
    for (const beacon of this.beacons) {
      this.beaconGroup?.remove(beacon.mesh);
      this.beaconGroup?.remove(beacon.light);
      beacon.mesh?.geometry?.dispose?.();
      beacon.mesh?.material?.dispose?.();
    }
    this.beacons.length = 0;
    if (!silent) {
      this.hud.setStatus('Navigation beacons recalled.');
    }
    this.minimapDirty = true;
    this._minimapTimer = 0;
  }

  _getSpawnTransform() {
    const fallback = this._createDefaultSpawnTransform();
    const caveSpawn = this._findCaveSpawnPoint();
    if (!caveSpawn) return fallback;
    return {
      position: caveSpawn.position ?? fallback.position.clone(),
      yaw: caveSpawn.yaw ?? fallback.yaw,
      pitch: caveSpawn.pitch ?? fallback.pitch,
      roll: caveSpawn.roll ?? fallback.roll,
      throttle: caveSpawn.throttle ?? fallback.throttle,
    };
  }

  _createDefaultSpawnTransform() {
    const anchorY = 48;
    const anchorVolume = this._queryVolumeAt(0, anchorY, 120);
    const ground = Number.isFinite(anchorVolume?.floor)
      ? anchorVolume.floor
      : this.terrain?.sampleHeight?.(0, anchorY) ?? 0;
    const startHeight = ground + 72;
    return {
      position: new THREE.Vector3(0, anchorY, startHeight),
      yaw: THREE.MathUtils.degToRad(180),
      pitch: THREE.MathUtils.degToRad(4),
      roll: 0,
      throttle: 0.46,
    };
  }

  _findCaveSpawnPoint() {
    if (!this.terrain?.queryVolume) return null;
    const chunkSize = this.terrain?.chunkSize ?? 16;
    const anchor = { x: 0, y: 48 };
    const range = chunkSize * 3;
    const step = Math.max(6, Math.floor(chunkSize / 2));

    let best = null;

    for (let dx = -range; dx <= range; dx += step) {
      for (let dy = -range; dy <= range; dy += step) {
        const x = anchor.x + dx;
        const y = anchor.y + dy;
        const surface = this.terrain?.sampleHeight?.(x, y);
        const startZ = Number.isFinite(surface) ? surface - 6 : 90;
        const minZ = startZ - 160;
        for (let z = startZ; z >= minZ; z -= 2.5) {
          const volume = this._queryVolumeAt(x, y, z);
          if (!volume || volume.inside) continue;
          if (!Number.isFinite(volume.floor) || !Number.isFinite(volume.ceiling)) continue;
          const clearance = volume.ceiling - volume.floor;
          if (clearance < 28) continue;
          const altitude = z - volume.floor;
          if (altitude < 12 || altitude > clearance - 10) continue;

          const score = clearance - Math.abs(altitude - clearance * 0.5);
          const height = volume.floor + Math.min(clearance - 10, Math.max(18, clearance * 0.45));
          if (!best || score > best.score) {
            best = {
              position: new THREE.Vector3(x, y, height),
              yaw: THREE.MathUtils.degToRad(180),
              pitch: THREE.MathUtils.degToRad(2.5),
              roll: 0,
              throttle: 0.42,
              score,
            };
          }
        }
      }
    }

    return best;
  }

  _queryVolumeAt(x, y, z = 0) {
    if (!this.terrain?.queryVolume) return null;
    const probe = new THREE.Vector3(x, y, z);
    return this.terrain.queryVolume(probe, { radius: 0, verticalRange: 160, step: 0.5 });
  }

  _generateSeed() {
    if (crypto?.getRandomValues) {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      return buf[0] >>> 0;
    }
    return Math.floor(Math.random() * 0xffffffff);
  }
}
