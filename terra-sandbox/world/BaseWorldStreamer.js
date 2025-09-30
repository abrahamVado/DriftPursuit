import { NoiseGenerator } from '../sandbox/Noise.js';
import { TERRAIN_PRESETS } from '../sandbox/terrainConfig.js';
import THREE from '../shared/threeProxy.js';
import {
  createRng,
  createCraterConfig,
  createLakeConfig,
  sampleHeightBase as sampleHeightBaseUtil,
  sampleHeight as sampleHeightUtil,
  slopeMagnitude as slopeMagnitudeUtil,
  craterContribution as craterContributionUtil,
} from './noiseUtils.js';
import {
  createColorState,
  sampleBiomeColor as sampleBiomeColorUtil,
  sampleColorLegacy as sampleColorLegacyUtil,
  sampleClimate as sampleClimateUtil,
  pickBiome as pickBiomeUtil,
} from './colorUtils.js';
import { createTerrainMesh } from './terrainMesh.js';
import { scatterTerrainFeatures } from './featureScatter.js';

const DEFAULT_THREE = THREE;

function chunkKey(x, y){
  return `${x}:${y}`;
}

function cloneGeneratorValue(value){
  if (Array.isArray(value)) return value.map(cloneGeneratorValue);
  if (value && typeof value === 'object'){
    const clone = {};
    for (const key of Object.keys(value)) clone[key] = cloneGeneratorValue(value[key]);
    return clone;
  }
  return value;
}

function mergeGeneratorConfig(base, override){
  if (!override || typeof override !== 'object') return cloneGeneratorValue(base);
  const result = Array.isArray(base) ? [] : {};
  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(override ?? {})]);
  keys.forEach((key) => {
    const b = base?.[key];
    const o = override?.[key];
    if (Array.isArray(b))             result[key] = Array.isArray(o) ? cloneGeneratorValue(o) : cloneGeneratorValue(b);
    else if (b && typeof b === 'object') result[key] = mergeGeneratorConfig(b, o);
    else if (o && typeof o === 'object') result[key] = cloneGeneratorValue(o);
    else                                result[key] = (o ?? b);
  });
  return result;
}

function getQueryPreset(){
  try {
    const p = new URLSearchParams(window.location.search).get('preset');
    return p && (p in TERRAIN_PRESETS) ? p : null;
  } catch {
    return null;
  }
}

export class BaseWorldStreamer {
  constructor({ scene, chunkSize = 600, radius = 3, seed = 1337, generator = null, procedural = null, THREE: injectedTHREE = null } = {}){
    this.THREE = injectedTHREE ?? DEFAULT_THREE;
    if (!this.THREE) throw new Error('BaseWorldStreamer requires THREE to be provided or available globally');

    const queryPreset = getQueryPreset();
    const presetBase = TERRAIN_PRESETS[queryPreset ?? 'default'] ?? TERRAIN_PRESETS.default;
    const overridePresetName = generator?.preset || procedural?.preset || null;
    const presetChosen = overridePresetName && TERRAIN_PRESETS[overridePresetName]
      ? TERRAIN_PRESETS[overridePresetName] : presetBase;
    const overrides = generator ?? procedural ?? null;
    const merged = mergeGeneratorConfig(presetChosen, overrides);

    const worldCfg = merged.world ?? {};
    this.scene = scene;
    this.chunkSize = chunkSize ?? worldCfg.tileSize ?? 900;
    this.radius = radius ?? worldCfg.visibleRadius ?? 3;
    this.seed = seed ?? merged.seed ?? 1337;
    this.scale = merged.scale ?? 1.0;

    this.noise = new NoiseGenerator(this.seed);
    this.generatorConfig = merged;

    this.world = {
      waterLevel: worldCfg.waterLevel ?? 18,
      snowline: worldCfg.snowline ?? 220,
      beachBand: worldCfg.beachBand ?? 10,
      bounds: worldCfg.bounds ?? null,
    };

    const colorState = createColorState({ colors: this.generatorConfig.colors ?? {}, THREE: this.THREE });
    this._ramps = colorState.ramps;
    this._colorGradient = colorState.gradient;

    this.volcano = this.generatorConfig.volcano ?? {};
    this._volcanoHasCenter = Array.isArray(this.volcano.center) && this.volcano.center.length >= 2;

    this.enableStars = this.generatorConfig.features?.stars ?? false;

    this.craterCfg = createCraterConfig(this.generatorConfig.craters || {});
    this.lakeCfg = createLakeConfig(this.generatorConfig.rivers?.lakes || {});

    this.worldGroup = new this.THREE.Group();
    this.worldGroup.name = 'EndlessTerrain';
    this.originOffset = new this.THREE.Vector3();
    this.chunkMap = new Map();
    this.disposables = [];
    this.materials = this._createSharedMaterials();
    this.sharedMaterials = new Set(Object.values(this.materials));
    this.disposables.push(...this.sharedMaterials);
    this.scene?.add(this.worldGroup);

    if (this.generatorConfig.features?.ocean !== false){
      this._ocean = this._createOcean();
      this.worldGroup.add(this._ocean);
    }

    if (this.enableStars && this.scene){
      this._stars = this._createStars();
      this.scene.add(this._stars);
    }

    [
      'update','handleOriginShift','getHeightAt','getOriginOffset','getObstaclesNear','dispose',
      '_positionChunk','_spawnChunk','_disposeChunk','_createTerrainMesh','_createSharedMaterials','_createOcean','_createStars',
      '_disposeMaterialIfOwned','_scatterTerrainFeatures','_sampleHeightBase','_sampleHeight','_slopeMagnitude','_sampleClimate',
      '_pickBiome','_sampleBiomeColor','_sampleColorLegacy','_addVolcanoLavaIfNeeded','_craterContribution',
    ].forEach((key) => { this[key] = this[key].bind(this); });
  }

  update(focusPosition){
    if (!focusPosition) return;
    const globalX = focusPosition.x + this.originOffset.x;
    const globalY = focusPosition.y + this.originOffset.y;
    const centerChunkX = Math.floor(globalX / this.chunkSize);
    const centerChunkY = Math.floor(globalY / this.chunkSize);
    const needed = new Set();

    for (let dx = -this.radius; dx <= this.radius; dx += 1){
      for (let dy = -this.radius; dy <= this.radius; dy += 1){
        const chunkX = centerChunkX + dx;
        const chunkY = centerChunkY + dy;
        const key = chunkKey(chunkX, chunkY);
        needed.add(key);
        let chunk = this.chunkMap.get(key);
        if (!chunk){
          chunk = this._spawnChunk(chunkX, chunkY);
          this.chunkMap.set(key, chunk);
          this.worldGroup.add(chunk.group);
        }
        this._positionChunk(chunk);
      }
    }

    this.chunkMap.forEach((chunk, key) => {
      if (!needed.has(key)){
        this._disposeChunk(chunk);
        this.chunkMap.delete(key);
      }
    });

    if (this._ocean){
      this._ocean.position.set(globalX - this.originOffset.x, globalY - this.originOffset.y, this.world.waterLevel - this.originOffset.z);
    }
    if (this._stars){
      this._stars.position.set(-this.originOffset.x, -this.originOffset.y, -this.originOffset.z);
    }
  }

  handleOriginShift(shift){
    if (!shift) return;
    this.originOffset.add(shift);
    this.chunkMap.forEach((chunk) => { if (chunk?.group) chunk.group.position.sub(shift); });
    if (this._ocean) this._ocean.position.sub(shift);
    if (this._stars) this._stars.position.sub(shift);
  }

  getHeightAt(x, y){
    const worldX = x + this.originOffset.x;
    const worldY = y + this.originOffset.y;
    return this._sampleHeight(worldX, worldY);
  }

  getOriginOffset(){
    return this.originOffset.clone();
  }

  getObstaclesNear(x, y, radius = this.chunkSize){
    const globalX = x + this.originOffset.x;
    const globalY = y + this.originOffset.y;
    const chunkX = Math.floor(globalX / this.chunkSize);
    const chunkY = Math.floor(globalY / this.chunkSize);
    const results = [];
    for (let dx = -1; dx <= 1; dx += 1){
      for (let dy = -1; dy <= 1; dy += 1){
        const chunk = this.chunkMap.get(chunkKey(chunkX + dx, chunkY + dy));
        if (chunk?.obstacles){
          chunk.obstacles.forEach((o) => {
            const dxw = o.worldPosition.x - globalX;
            const dyw = o.worldPosition.y - globalY;
            const horizontalSq = dxw * dxw + dyw * dyw;
            if (horizontalSq <= (radius + o.radius) * (radius + o.radius)) results.push(o);
          });
        }
      }
    }
    return results;
  }

  dispose(){
    this.chunkMap.forEach((chunk) => this._disposeChunk(chunk));
    this.chunkMap.clear();
    if (this._ocean) this.worldGroup.remove(this._ocean);
    if (this.scene) this.scene.remove(this.worldGroup);
    if (this._stars && this.scene) this.scene.remove(this._stars);
    this.disposables.forEach((item) => item.dispose?.());
    this.disposables = [];
  }

  _positionChunk(chunk){
    const worldX = chunk.coords.x * this.chunkSize;
    const worldY = chunk.coords.y * this.chunkSize;
    chunk.group.position.set(worldX - this.originOffset.x, worldY - this.originOffset.y, -this.originOffset.z);
  }

  _spawnChunk(chunkX, chunkY){
    const coords = { x: chunkX, y: chunkY };
    const group = new this.THREE.Group();
    group.name = `TerrainChunk_${chunkX}_${chunkY}`;
    const rng = createRng((chunkX * 928371 + chunkY * 123123 + this.seed) >>> 0);

    const terrain = this._createTerrainMesh(chunkX, chunkY);
    group.add(terrain.mesh);

    this._addVolcanoLavaIfNeeded({ chunkX, chunkY, group });

    const { obstacles } = this._scatterTerrainFeatures({ chunkX, chunkY, rng, group });

    return { coords, group, obstacles, terrain };
  }

  _disposeChunk(chunk){
    if (!chunk) return;
    if (chunk.group){
      this.worldGroup.remove(chunk.group);
      chunk.group.traverse((child) => {
        if (child.isMesh){
          child.geometry?.dispose?.();
          this._disposeMaterialIfOwned(child.material);
        }
      });
    }
  }

  _createTerrainMesh(chunkX, chunkY){
    return createTerrainMesh({
      chunkX,
      chunkY,
      chunkSize: this.chunkSize,
      generatorConfig: this.generatorConfig,
      sampleHeight: this._sampleHeight,
      sampleColor: this._sampleBiomeColor,
      volcano: this.volcano,
      noise: this.noise,
      THREE: this.THREE,
    });
  }

  _createSharedMaterials(){
    return {
      mountain: new this.THREE.MeshStandardMaterial({ color: 0x8f8375, roughness: 0.85, metalness: 0.08, flatShading: true }),
      rock: new this.THREE.MeshStandardMaterial({ color: 0x6b6156, roughness: 0.95, metalness: 0.04, flatShading: true }),
      building: new this.THREE.MeshStandardMaterial({ color: 0xb69a7a, roughness: 0.6, metalness: 0.08 }),
      roof: new this.THREE.MeshStandardMaterial({ color: 0x7a3529, roughness: 0.4, metalness: 0.12 }),
      plaza: new this.THREE.MeshStandardMaterial({ color: 0xd9c9a7, roughness: 0.85, metalness: 0.02 }),
      water: new this.THREE.MeshStandardMaterial({ color: 0x3f75d6, emissive: 0x0, roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.82 }),
    };
  }

  _createOcean(){
    const geo = new this.THREE.PlaneGeometry(this.chunkSize * (this.radius * 2 + 4), this.chunkSize * (this.radius * 2 + 4), 1, 1);
    const mesh = new this.THREE.Mesh(geo, this.materials.water);
    mesh.rotation.x = 0;
    mesh.position.set(0, 0, this.world.waterLevel);
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.renderOrder = -10;
    mesh.name = 'OceanSheet';
    return mesh;
  }

  _createStars(){
    const starCount = 2000;
    const radius = this.chunkSize * (this.radius * 2 + 6);
    const geom = new this.THREE.BufferGeometry();
    const positions = new Float32Array(starCount * 3);
    const rng = createRng(this.seed ^ 0xdeadbeef);
    for (let i = 0; i < starCount; i += 1){
      const u = rng();
      const v = rng();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = radius;
      positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi) + 5000;
    }
    geom.setAttribute('position', new this.THREE.BufferAttribute(positions, 3));
    const mat = new this.THREE.PointsMaterial({ size: 2, sizeAttenuation: true, color: 0xffffff, transparent: true, opacity: 0.9 });
    const pts = new this.THREE.Points(geom, mat);
    pts.name = 'Starfield';
    this.disposables.push(mat);
    return pts;
  }

  _disposeMaterialIfOwned(material){
    if (!material) return;
    if (Array.isArray(material)){ material.forEach((m) => this._disposeMaterialIfOwned(m)); return; }
    if (this.sharedMaterials?.has(material)) return;
    material.dispose?.();
  }

  _scatterTerrainFeatures({ chunkX, chunkY, rng, group }){
    return scatterTerrainFeatures({
      chunkX,
      chunkY,
      rng,
      group,
      generatorConfig: this.generatorConfig,
      chunkSize: this.chunkSize,
      noise: this.noise,
      materials: this.materials,
      THREE: this.THREE,
      sampleHeight: this._sampleHeight,
      slopeMagnitude: this._slopeMagnitude,
      world: this.world,
      lakeConfig: this.lakeCfg,
    });
  }

  _sampleHeightBase(worldX, worldY){
    return sampleHeightBaseUtil({ worldX, worldY, generatorConfig: this.generatorConfig, noise: this.noise });
  }

  _craterContribution(worldX, worldY){
    return craterContributionUtil({ worldX, worldY, craterConfig: this.craterCfg, seed: this.seed });
  }

  _sampleHeight(worldX, worldY){
    return sampleHeightUtil({
      worldX,
      worldY,
      generatorConfig: this.generatorConfig,
      noise: this.noise,
      craterConfig: this.craterCfg,
      seed: this.seed,
      volcano: this.volcano,
    });
  }

  _slopeMagnitude(worldX, worldY){
    return slopeMagnitudeUtil({ worldX, worldY, sampleHeight: this._sampleHeight });
  }

  _sampleClimate(worldX, worldY){
    return sampleClimateUtil({ worldX, worldY, generatorConfig: this.generatorConfig, noise: this.noise });
  }

  _pickBiome(height, temp, moist){
    return pickBiomeUtil({ height, climate: { temp, moist }, generatorConfig: this.generatorConfig, world: this.world });
  }

  _sampleBiomeColor(worldX, worldY, height){
    return sampleBiomeColorUtil({
      worldX,
      worldY,
      height,
      ramps: this._ramps,
      gradient: this._colorGradient,
      world: this.world,
      generatorConfig: this.generatorConfig,
      noise: this.noise,
      THREE: this.THREE,
    });
  }

  _sampleColorLegacy(height){
    return sampleColorLegacyUtil({ gradient: this._colorGradient, height });
  }

  _addVolcanoLavaIfNeeded({ chunkX, chunkY, group }){
    const v = this.volcano;
    if (!v?.enabled || !this._volcanoHasCenter) return;
    if (group.userData.__lavaAdded) return;

    const cx = v.center[0] ?? 0;
    const cy = v.center[1] ?? 0;
    const x0 = chunkX * this.chunkSize;
    const y0 = chunkY * this.chunkSize;
    const x1 = x0 + this.chunkSize;
    const y1 = y0 + this.chunkSize;
    if (cx < x0 || cx >= x1 || cy < y0 || cy >= y1) return;

    const craterHeight = this._sampleHeight(cx, cy);
    const lavaLevel = craterHeight + (v.lava?.levelOffset ?? -12);

    const radius = (v.craterRadius ?? 220) * 0.92;
    const geo = new this.THREE.CircleGeometry(radius, 48);
    const mat = new this.THREE.MeshStandardMaterial({
      color: new this.THREE.Color(v.lava?.color ?? '#ff5a1f'),
      emissive: new this.THREE.Color(v.lava?.emissive ?? '#ff8a00'),
      emissiveIntensity: v.lava?.emissiveIntensity ?? 1.6,
      roughness: 0.35,
      metalness: 0.1,
    });
    const mesh = new this.THREE.Mesh(geo, mat);
    mesh.position.set(cx - x0, cy - y0, lavaLevel);
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.name = 'VolcanoLava';
    group.add(mesh);

    this.disposables.push(mat);
    group.userData.__lavaAdded = true;
  }
}
