// WorldStreamer.js
import { NoiseGenerator } from './Noise.js';
import { TERRAIN_PRESETS } from './terrainConfig.js';

const THREE = (typeof window !== 'undefined' ? window.THREE : globalThis?.THREE) ?? null;
if (!THREE) throw new Error('Sandbox WorldStreamer requires THREE to be loaded globally');

function chunkKey(x, y){ return `${x}:${y}`; }

function createRng(seed){
  let state = seed >>> 0;
  return function(){
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --------- MERGE UTILS (deep-ish; keeps your old semantics)
function cloneGeneratorValue(value){
  if (Array.isArray(value)) return value.map(cloneGeneratorValue);
  if (value && typeof value === 'object'){
    const clone = {};
    for (const k of Object.keys(value)) clone[k] = cloneGeneratorValue(value[k]);
    return clone;
  }
  return value;
}
function mergeGeneratorConfig(base, override){
  if (!override || typeof override !== 'object') return cloneGeneratorValue(base);
  const result = Array.isArray(base) ? [] : {};
  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(override ?? {})]);
  keys.forEach((key) => {
    const b = base?.[key]; const o = override?.[key];
    if (Array.isArray(b))             result[key] = Array.isArray(o) ? cloneGeneratorValue(o) : cloneGeneratorValue(b);
    else if (b && typeof b==='object') result[key] = mergeGeneratorConfig(b, o);
    else if (o && typeof o==='object') result[key] = cloneGeneratorValue(o);
    else                                result[key] = (o ?? b);
  });
  return result;
}

// --------- HELPERS: query param → preset
function getQueryPreset(){
  try {
    const p = new URLSearchParams(window.location.search).get('preset');
    return p && (p in TERRAIN_PRESETS) ? p : null;
  } catch { return null; }
}

// --------- COLOR HELPERS
function lerpColorStops(colors, t){
  // colors can be ['#a','#b','#c'] or [[0,'#a'],[0.5,'#b'],[1,'#c']]
  const stops = Array.isArray(colors[0]) ? colors : colors.map((c,i,arr)=>[i/(arr.length-1), c]);
  const tt = THREE.MathUtils.clamp(t, 0, 1);
  for (let i=0;i<stops.length-1;i++){
    const [t0,c0] = stops[i]; const [t1,c1] = stops[i+1];
    if (tt >= t0 && tt <= t1){
      const f = (tt - t0) / Math.max(1e-6, (t1 - t0));
      const col0 = new THREE.Color(c0); const col1 = new THREE.Color(c1);
      return col0.lerp(col1, f);
    }
  }
  return new THREE.Color(stops[stops.length-1][1]);
}

// --------- DETERMINISTIC CELL RNG (for craters/lakes)
function hash2i(x, y){
  // 2D int hash → 32-bit
  let h = x | 0;
  h = Math.imul(h ^ 0x9e3779b9, 0x85ebca6b) ^ y | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
function rngFromCell(cx, cy, seed){
  return createRng(hash2i(hash2i(cx, cy), seed));
}

export class WorldStreamer {
  constructor({ scene, chunkSize = 600, radius = 3, seed = 1337, generator = null, procedural = null } = {}){
    // ----- pick preset → merge with overrides (keeps old fields if present)
    const queryPreset = getQueryPreset();
    const presetBase = TERRAIN_PRESETS[queryPreset ?? 'default'] ?? TERRAIN_PRESETS.default;

    // If user passes generator.preset = 'ultra' (etc.), prefer that over query
    const overridePresetName = generator?.preset || procedural?.preset || null;
    const presetChosen = overridePresetName && TERRAIN_PRESETS[overridePresetName]
      ? TERRAIN_PRESETS[overridePresetName] : presetBase;

    const overrides = generator ?? procedural ?? null;
    const merged = mergeGeneratorConfig(presetChosen, overrides);

    // Wire globals from config if not explicitly provided
    const worldCfg = merged.world ?? {};
    this.scene = scene;
    this.chunkSize = chunkSize ?? worldCfg.tileSize ?? 900;
    this.radius = radius ?? worldCfg.visibleRadius ?? 3;
    this.seed = seed ?? merged.seed ?? 1337;
    this.scale = merged.scale ?? 1.0;

    // Core noise + climate
    this.noise = new NoiseGenerator(this.seed);
    this.generatorConfig = merged;

    this.world = {
      waterLevel: worldCfg.waterLevel ?? 18,
      snowline: worldCfg.snowline ?? 220,
      beachBand: worldCfg.beachBand ?? 10,
      bounds: worldCfg.bounds ?? null,
    };

    // Precompute color ramps if present
    const colors = this.generatorConfig.colors ?? {};
    this._ramps = colors.ramps ?? null;
    this._colorGradient = {
      low: new THREE.Color(colors.low ?? '#2f5b2f'),
      mid: new THREE.Color(colors.mid ?? '#4e7741'),
      high: new THREE.Color(colors.high ?? '#c2c5c7'),
      lowThreshold: colors.lowThreshold ?? 30,
      highThreshold: colors.highThreshold ?? 140,
      highCap: colors.highCap ?? 300,
    };

    // Volcano config cache
    this.volcano = (this.generatorConfig.volcano ?? {});
    this._volcanoHasCenter =
      Array.isArray(this.volcano.center) && this.volcano.center.length >= 2;

    // Optional stars
    this.enableStars = this.generatorConfig.features?.stars ?? false;

    // Craters pass (independent of volcano)
    this.craterCfg = Object.assign({
      enabled: true,
      spacing: 1200,       // average cell size in world units
      chance: 0.22,        // per-cell chance
      radius: [120, 340],  // min..max
      depth: [20, 120],    // bowl depth
      rimSharpness: 1.8,   // profile exponent
      jitter: 0.42,        // randomize center within cell
    }, this.generatorConfig.craters || {});

    // Lakes pass (independent of rivers)
    this.lakeCfg = Object.assign({
      enabled: !!(this.generatorConfig.rivers?.lakes?.enabled ?? true),
      perChunk: 1,
      noiseFrequency: 0.0009,
      threshold: 0.58,
      radius: [18, 80],
      levelOffset: -2,
    }, this.generatorConfig.rivers?.lakes || {});

    this.worldGroup = new THREE.Group();
    this.worldGroup.name = 'EndlessTerrain';
    this.originOffset = new THREE.Vector3();
    this.chunkMap = new Map();
    this.disposables = [];
    this.materials = this._createSharedMaterials();
    this.sharedMaterials = new Set(Object.values(this.materials));
    this.disposables.push(...this.sharedMaterials);
    this.scene?.add(this.worldGroup);

    // Optional: add an ocean sheet (simple, infinite feel)
    if (this.generatorConfig.features?.ocean !== false){
      this._ocean = this._createOcean();
      this.worldGroup.add(this._ocean);
    }

    // Optional starfield
    if (this.enableStars && this.scene){
      this._stars = this._createStars();
      this.scene.add(this._stars);
    }

    // — bind methods so they always exist as functions on the instance
    [
      'update','handleOriginShift','getHeightAt','getOriginOffset','getObstaclesNear','dispose',
      '_positionChunk','_spawnChunk','_disposeChunk',
      '_createTerrainMesh','_createSharedMaterials','_createOcean','_createStars','_disposeMaterialIfOwned',
      '_scatterTerrainFeatures','_maybeAddMountain','_scatterRocks','_maybeAddTown','_maybeAddRiver','_maybeAddLakes',
      '_findLocation','_sampleHeightBase','_sampleHeight','_slopeMagnitude',
      '_sampleClimate','_pickBiome','_sampleBiomeColor','_sampleColorLegacy',
      '_addVolcanoLavaIfNeeded','_craterContribution'
    ].forEach((k) => { this[k] = this[k].bind(this); });
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

    // keep ocean under camera
    if (this._ocean){
      this._ocean.position.set(globalX - this.originOffset.x, globalY - this.originOffset.y, this.world.waterLevel - this.originOffset.z);
    }
    // keep stars centered
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

  getOriginOffset(){ return this.originOffset.clone(); }

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
    const group = new THREE.Group();
    group.name = `TerrainChunk_${chunkX}_${chunkY}`;
    const rng = createRng((chunkX * 928371 + chunkY * 123123 + this.seed) >>> 0);

    const terrain = this._createTerrainMesh(chunkX, chunkY);
    group.add(terrain.mesh);

    // volcano lava if this chunk contains the volcano center
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
    // Use perf controls if present
    const detailScale = this.generatorConfig?.perf?.meshDetail ?? 1.0;
    const baseRes = 64;
    const resolution = Math.max(8, Math.round(baseRes * detailScale));
    const geometry = new THREE.PlaneGeometry(this.chunkSize, this.chunkSize, resolution, resolution);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    const positions = geometry.attributes.position;
    const chunkOriginX = chunkX * this.chunkSize;
    const chunkOriginY = chunkY * this.chunkSize;

    for (let i = 0; i < positions.count; i += 1){
      const localX = positions.getX(i);
      const localY = positions.getY(i);
      const worldX = chunkOriginX + localX;
      const worldY = chunkOriginY + localY;
      const height = this._sampleHeight(worldX, worldY);
      positions.setZ(i, height);

      const colorIndex = i * 3;
      const color = this._sampleBiomeColor(worldX, worldY, height);
      colors[colorIndex] = color.r;
      colors[colorIndex + 1] = color.g;
      colors[colorIndex + 2] = color.b;
    }

    // Optional: jagged rim displacement (visual spice) near volcano crater
    if (this.volcano?.enabled && this._volcanoHasCenter){
      const v = this.volcano;
      const cx = v.center[0] ?? 0, cy = v.center[1] ?? 0;
      const rc = v.craterRadius ?? 220;
      const band = rc * 0.18;
      const f = v.noise?.frequency ?? 0.0028;
      const amp = (v.noise?.amplitude ?? 65) * 0.5;
      for (let i = 0; i < positions.count; i++){
        const lx = positions.getX(i);
        const ly = positions.getY(i);
        const wx = chunkOriginX + lx;
        const wy = chunkOriginY + ly;
        const r = Math.hypot(wx - cx, wy - cy);
        const d = Math.abs(r - rc);
        if (d < band){
          const k = 1 - d / band;
          const jag = (this.noise.perlin2(wx * f, wy * f) * 2 - 1) * amp * k;
          positions.setZ(i, positions.getZ(i) + jag);
        }
      }
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.05,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.rotation.x = 0; // plane is already XY with Z up via setZ

    return { mesh, geometry, material };
  }

  _createSharedMaterials(){
    return {
      mountain: new THREE.MeshStandardMaterial({ color: 0x8f8375, roughness: 0.85, metalness: 0.08, flatShading: true }),
      rock: new THREE.MeshStandardMaterial({ color: 0x6b6156, roughness: 0.95, metalness: 0.04, flatShading: true }),
      building: new THREE.MeshStandardMaterial({ color: 0xb69a7a, roughness: 0.6, metalness: 0.08 }),
      roof: new THREE.MeshStandardMaterial({ color: 0x7a3529, roughness: 0.4, metalness: 0.12 }),
      plaza: new THREE.MeshStandardMaterial({ color: 0xd9c9a7, roughness: 0.85, metalness: 0.02 }),
      water: new THREE.MeshStandardMaterial({ color: 0x3f75d6, emissive: 0x0, roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.82 })
    };
  }

  _createOcean(){
    const geo = new THREE.PlaneGeometry(this.chunkSize * (this.radius * 2 + 4), this.chunkSize * (this.radius * 2 + 4), 1, 1);
    const mesh = new THREE.Mesh(geo, this.materials.water);
    mesh.rotation.x = 0;
    mesh.position.set(0, 0, this.world.waterLevel);
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.renderOrder = -10;
    mesh.name = 'OceanSheet';
    return mesh;
  }

  _createStars(){
    // simple static starfield around world origin
    const starCount = 2000;
    const radius = this.chunkSize * (this.radius * 2 + 6);
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(starCount * 3);
    const rng = createRng(this.seed ^ 0xdeadbeef);
    for (let i=0;i<starCount;i++){
      // random on sphere
      const u = rng(); const v = rng();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2*v - 1);
      const r = radius;
      positions[i*3+0] = r * Math.sin(phi) * Math.cos(theta);
      positions[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i*3+2] = r * Math.cos(phi)    + 5000; // push above ground a bit
    }
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ size: 2, sizeAttenuation: true, color: 0xffffff, transparent: true, opacity: 0.9 });
    const pts = new THREE.Points(geom, mat);
    pts.name = 'Starfield';
    this.disposables.push(mat);
    return pts;
  }

  _disposeMaterialIfOwned(material){
    if (!material) return;
    if (Array.isArray(material)){ material.forEach((m)=>this._disposeMaterialIfOwned(m)); return; }
    if (this.sharedMaterials?.has(material)) return;
    material.dispose?.();
  }

  _scatterTerrainFeatures({ chunkX, chunkY, rng, group }){
    const obstacles = [];
    const features = this.generatorConfig.features ?? {};
    if (features.mountains !== false) this._maybeAddMountain({ chunkX, chunkY, rng, group, obstacles });
    if (features.rocks !== false)     this._scatterRocks({ chunkX, chunkY, rng, group, obstacles });
    if (features.towns !== false)     this._maybeAddTown({ chunkX, chunkY, rng, group, obstacles });
    if (features.rivers !== false)    this._maybeAddRiver({ chunkX, chunkY, rng, group });
    if (this.lakeCfg.enabled !== false) this._maybeAddLakes({ chunkX, chunkY, rng, group });
    return { obstacles };
  }

  // ----------------- MOUNTAINS/ROCKS/TOWNS/RIVERS/LAKES -----------------
  _maybeAddMountain({ chunkX, chunkY, rng, group, obstacles }){
    const centerX = (chunkX + 0.5) * this.chunkSize;
    const centerY = (chunkY + 0.5) * this.chunkSize;
    const config = this.generatorConfig.mountains ?? {};
    const noiseCfg = config.noise ?? {};
    const noise = this.noise.fractal2(
      centerX * (noiseCfg.frequency ?? 0) + (noiseCfg.offset?.[0] ?? 0),
      centerY * (noiseCfg.frequency ?? 0) + (noiseCfg.offset?.[1] ?? 0),
      { octaves: noiseCfg.octaves ?? 5, persistence: noiseCfg.persistence ?? 0.58, lacunarity: noiseCfg.lacunarity ?? 2.18 },
    );
    const threshold = config.threshold ?? 0.64;
    if (noise < threshold) return;

    const clusterThreshold = config.clusterThreshold ?? threshold + 0.14;
    const maxClusters = Math.max(1, Math.round(config.clusterCount ?? 2));
    const clusterCount = noise > clusterThreshold ? maxClusters : 1;
    const attempts = config.locationAttempts ?? 10;
    for (let c = 0; c < clusterCount; c += 1){
      const location = this._findLocation({
        chunkX, chunkY, rng, attempts,
        minHeight: config.minHeight ?? 120, maxSlope: config.maxSlope ?? 0.55,
      });
      if (!location) break;

      const baseHeight = location.height;
      const heightMin = config.heightGain?.min ?? 120;
      const heightMax = config.heightGain?.max ?? 340;
      const heightGain = heightMin + rng() * Math.max(0, heightMax - heightMin);
      const radiusMin = config.radius?.min ?? 60;
      const radiusMax = config.radius?.max ?? 150;
      const radius = radiusMin + rng() * Math.max(0, radiusMax - radiusMin);
      const segmentsMin = Math.max(3, Math.round(config.segments?.min ?? 8));
      const segmentsMax = Math.max(segmentsMin, Math.round(config.segments?.max ?? 12));
      const segmentSpan = segmentsMax - segmentsMin + 1;
      const segments = segmentsMin + Math.floor(rng() * segmentSpan);

      const geometry = new THREE.ConeGeometry(radius, heightGain, segments);
      const mesh = new THREE.Mesh(geometry, this.materials.mountain);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.position.set(location.localX, location.localY, baseHeight + heightGain / 2);
      group.add(mesh);

      const peakHeight = baseHeight + heightGain;
      obstacles.push({
        mesh, radius: radius * 0.95,
        worldPosition: new THREE.Vector3(location.worldX, location.worldY, peakHeight),
        topHeight: peakHeight, baseHeight, type: 'mountain',
      });
    }
  }

  _scatterRocks({ chunkX, chunkY, rng, group, obstacles }){
    const centerX = (chunkX + 0.5) * this.chunkSize;
    const centerY = (chunkY + 0.5) * this.chunkSize;
    const config = this.generatorConfig.rocks ?? {};
    const noiseCfg = config.noise ?? {};
    const densityNoise = this.noise.perlin2(
      centerX * (noiseCfg.frequency ?? 0) + (noiseCfg.offset?.[0] ?? 0),
      centerY * (noiseCfg.frequency ?? 0) + (noiseCfg.offset?.[1] ?? 0),
    );
    const countBase = config.baseCount ?? 2;
    const countScale = config.densityScale ?? 6;
    const rawCount = Math.floor(countBase + densityNoise * countScale);
    const count = Math.max(0, rawCount);
    for (let i = 0; i < count; i += 1){
      const location = this._findLocation({
        chunkX, chunkY, rng, attempts: config.attempts ?? 6, maxSlope: config.maxSlope ?? 0.45,
      });
      if (!location) break;
      const sizeMin = config.size?.min ?? 6;
      const sizeMax = config.size?.max ?? 24;
      const size = sizeMin + rng() * Math.max(0, sizeMax - sizeMin);
      const detailThreshold = config.detailThreshold ?? 0.55;
      const detail = rng() > detailThreshold ? 1 : 0;
      const geometry = new THREE.DodecahedronGeometry(size, detail);
      const mesh = new THREE.Mesh(geometry, this.materials.rock);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.position.set(location.localX, location.localY, location.height + size * 0.45);
      group.add(mesh);

      obstacles.push({
        mesh, radius: size * 0.8,
        worldPosition: new THREE.Vector3(location.worldX, location.worldY, location.height + size),
        topHeight: location.height + size * 1.2,
        baseHeight: location.height, type: 'rock',
      });
    }
  }

  _maybeAddTown({ chunkX, chunkY, rng, group, obstacles }){
    const centerX = (chunkX + 0.5) * this.chunkSize;
    const centerY = (chunkY + 0.5) * this.chunkSize;
    const config = this.generatorConfig.towns ?? {};
    const noiseCfg = config.noise ?? {};
    const settlementNoise = this.noise.fractal2(
      centerX * (noiseCfg.frequency ?? 0) + (noiseCfg.offset?.[0] ?? 0),
      centerY * (noiseCfg.frequency ?? 0) + (noiseCfg.offset?.[1] ?? 0),
      { octaves: noiseCfg.octaves ?? 4, persistence: noiseCfg.persistence ?? 0.6, lacunarity: noiseCfg.lacunarity ?? 2.3 },
    );
    if (settlementNoise < (config.threshold ?? 0.66)) return;

    const anchorCfg = config.anchor ?? {};
    const anchor = this._findLocation({
      chunkX, chunkY, rng,
      attempts: anchorCfg.attempts ?? 12, maxSlope: anchorCfg.maxSlope ?? 0.18, maxHeight: anchorCfg.maxHeight ?? 180,
    });
    if (!anchor) return;

    const townGroup = new THREE.Group();
    townGroup.name = `Town_${chunkX}_${chunkY}`;
    group.add(townGroup);

    const plazaMin = config.plazaRadius?.min ?? 16;
    const plazaMax = config.plazaRadius?.max ?? 26;
    const plazaRadius = plazaMin + rng() * Math.max(0, plazaMax - plazaMin);
    const plazaGeometry = new THREE.CircleGeometry(plazaRadius, 24);
    const plaza = new THREE.Mesh(plazaGeometry, this.materials.plaza);
    plaza.position.set(anchor.localX, anchor.localY, anchor.height + 0.4);
    plaza.receiveShadow = true;
    townGroup.add(plaza);

    const buildingCountMin = Math.max(0, Math.round(config.buildingCount?.min ?? 4));
    const buildingCountMax = Math.max(buildingCountMin, Math.round(config.buildingCount?.max ?? 8));
    const buildingCountRange = buildingCountMax - buildingCountMin + 1;
    const buildingCount = buildingCountMin + Math.floor(rng() * buildingCountRange);
    const buildingSlopeLimit = config.buildingPlacementMaxSlope ?? 0.24;
    for (let i = 0; i < buildingCount; i += 1){
      const angle = rng() * Math.PI * 2;
      const distance = plazaRadius + (config.buildingDistance?.offset ?? 8) + rng() * Math.max(0, config.buildingDistance?.range ?? 35);
      const worldX = anchor.worldX + Math.cos(angle) * distance;
      const worldY = anchor.worldY + Math.sin(angle) * distance;
      const slope = this._slopeMagnitude(worldX, worldY);
      if (slope > buildingSlopeLimit) continue;
      const height = this._sampleHeight(worldX, worldY);
      const widthMin = config.buildingWidth?.min ?? 12;
      const widthMax = config.buildingWidth?.max ?? 26;
      const width = widthMin + rng() * Math.max(0, widthMax - widthMin);
      const depthMin = config.buildingDepth?.min ?? 10;
      const depthMax = config.buildingDepth?.max ?? 28;
      const depth = depthMin + rng() * Math.max(0, depthMax - depthMin);
      const wallMin = config.wallHeight?.min ?? 12;
      const wallMax = config.wallHeight?.max ?? 22;
      const wallHeight = wallMin + rng() * Math.max(0, wallMax - wallMin);
      const roofHeight = wallHeight * (config.roofHeightScale ?? 0.6);

      const base = new THREE.Mesh(new THREE.BoxGeometry(width, depth, wallHeight), this.materials.building);
      const localX = worldX - chunkX * this.chunkSize;
      const localY = worldY - chunkY * this.chunkSize;
      base.position.set(localX, localY, height + wallHeight / 2);
      base.castShadow = true; base.receiveShadow = true;
      townGroup.add(base);

      const roofRadius = Math.max(width, depth) * 0.75;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(roofRadius, roofHeight, 4), this.materials.roof);
      roof.position.set(localX, localY, height + wallHeight + roofHeight / 2);
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true; roof.receiveShadow = true;
      townGroup.add(roof);

      obstacles.push({
        mesh: base, radius: Math.max(width, depth) * 0.6,
        worldPosition: new THREE.Vector3(worldX, worldY, height + wallHeight),
        topHeight: height + wallHeight + roofHeight,
        baseHeight: height, type: 'building',
      });
    }
  }

  _maybeAddRiver({ chunkX, chunkY, rng, group }){
    const centerX = (chunkX + 0.5) * this.chunkSize;
    const centerY = (chunkY + 0.5) * this.chunkSize;
    const config = this.generatorConfig.rivers ?? {};
    const noiseCfg = config.noise ?? {};
    const riverNoise = this.noise.perlin2(
      centerX * (noiseCfg.frequency ?? 0) + (noiseCfg.offset?.[0] ?? 0),
      centerY * (noiseCfg.frequency ?? 0) + (noiseCfg.offset?.[1] ?? 0),
    ) - 0.5;
    const closeness = Math.abs(riverNoise);
    const threshold = config.threshold ?? 0.085;
    if (closeness > threshold) return;

    const angleCfg = config.angleNoise ?? {};
    const angleNoise = this.noise.perlin2(
      centerX * (angleCfg.frequency ?? 0) + (angleCfg.offset?.[0] ?? 0),
      centerY * (angleCfg.frequency ?? 0) + (angleCfg.offset?.[1] ?? 0),
    );
    const angle = angleNoise * Math.PI * 2;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const perpX = -dirY;
    const perpY = dirX;
    const length = this.chunkSize * (config.lengthMultiplier ?? 1.5);
    const width = THREE.MathUtils.lerp(
      config.width?.min ?? 26,
      config.width?.max ?? 58,
      1 - THREE.MathUtils.clamp(closeness / Math.max(1e-6, threshold), 0, 1),
    );
    const halfWidth = width / 2;
    const segments = Math.max(2, Math.round(config.segments ?? 18));

    const positions = new Float32Array((segments + 1) * 2 * 3);
    const indices = [];

    for (let i = 0; i <= segments; i += 1){
      const t = (i / segments - 0.5) * length;
      const meanderCfg = config.meander ?? {};
      const meander = (this.noise.perlin2(
        centerX * (meanderCfg.frequency ?? 0.0012) + t * (meanderCfg.tFrequency ?? 0.002),
        centerY * (meanderCfg.frequency ?? 0.0012) - t * (meanderCfg.tFrequency ?? 0.002),
      ) - 0.5) * width * (meanderCfg.scale ?? 0.6);
      const centerWorldX = centerX + dirX * t + perpX * meander;
      const centerWorldY = centerY + dirY * t + perpY * meander;
      for (let side = 0; side < 2; side += 1){
        const sign = side === 0 ? -1 : 1;
        const worldX = centerWorldX + perpX * sign * halfWidth;
        const worldY = centerWorldY + perpY * sign * halfWidth;
        const height = this._sampleHeight(worldX, worldY) - (config.depth ?? 2.8);
        const localX = worldX - chunkX * this.chunkSize;
        const localY = worldY - chunkY * this.chunkSize;
        const index = (i * 2 + side) * 3;
        positions[index] = localX;
        positions[index + 1] = localY;
        positions[index + 2] = height;
      }
    }

    for (let i = 0; i < segments; i += 1){
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, b, d, a, d, c);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, this.materials.water);
    mesh.receiveShadow = false; mesh.castShadow = false;
    group.add(mesh);
  }

  _maybeAddLakes({ chunkX, chunkY, rng, group }){
    if (!this.lakeCfg.enabled) return;
    const per = Math.max(0, Math.floor(this.lakeCfg.perChunk ?? 1));
    if (per <= 0) return;

    const cx = (chunkX + 0.5) * this.chunkSize;
    const cy = (chunkY + 0.5) * this.chunkSize;
    const f = this.lakeCfg.noiseFrequency ?? 0.0009;
    const base = this.noise.perlin2(cx * f, cy * f);
    if (base < (this.lakeCfg.threshold ?? 0.58)) return;

    for (let i=0;i<per;i++){
      // jitter position within chunk
      const jx = (rng() - 0.5) * this.chunkSize * 0.6;
      const jy = (rng() - 0.5) * this.chunkSize * 0.6;
      const wx = cx + jx;
      const wy = cy + jy;
      const h = this._sampleHeight(wx, wy);
      // only place in depressions near or below water
      if (h > this.world.waterLevel + 6) continue;

      const rmin = this.lakeCfg.minRadius ?? this.lakeCfg.radius?.[0] ?? 18;
      const rmax = this.lakeCfg.maxRadius ?? this.lakeCfg.radius?.[1] ?? 80;
      const r = rmin + rng() * Math.max(0, rmax - rmin);

      const geo = new THREE.CircleGeometry(r, 32);
      const mesh = new THREE.Mesh(geo, this.materials.water);
      mesh.position.set(wx - chunkX * this.chunkSize, wy - chunkY * this.chunkSize, Math.min(h - 1, this.world.waterLevel + (this.lakeCfg.levelOffset ?? -2)));
      mesh.receiveShadow = false; mesh.castShadow = false;
      mesh.name = 'Lake';
      group.add(mesh);
    }
  }

  _findLocation({ chunkX, chunkY, rng, attempts = 8, minHeight = -Infinity, maxHeight = Infinity, maxSlope = 0.5 }){
    for (let attempt = 0; attempt < attempts; attempt += 1){
      const localX = (rng() - 0.5) * this.chunkSize * 0.9;
      const localY = (rng() - 0.5) * this.chunkSize * 0.9;
      const worldX = chunkX * this.chunkSize + localX;
      const worldY = chunkY * this.chunkSize + localY;
      const height = this._sampleHeight(worldX, worldY);
      if (height < minHeight || height > maxHeight) continue;
      const slope = this._slopeMagnitude(worldX, worldY);
      if (slope > maxSlope) continue;
      return { localX, localY, worldX, worldY, height, slope };
    }
    return null;
  }

  // ----------------- HEIGHTFIELD -----------------
  _sampleHeightBase(worldX, worldY){
    const cfg = this.generatorConfig;
    const { noise, plateau } = cfg;

    // Domain warp
    let sx = worldX, sy = worldY;
    const warp = noise?.warp;
    if (warp){
      const wf = warp.frequency ?? 0;
      const wo = warp.offset ?? [0,0];
      const wx = this.noise.perlin2(worldX * wf + (wo[0] ?? 0), worldY * wf + (wo[1] ?? 0));
      const wy = this.noise.perlin2((worldX + 1000) * wf + (wo[0] ?? 0), (worldY - 1000) * wf + (wo[1] ?? 0));
      const wa = warp.amplitude ?? 0;
      sx += wx * wa;
      sy += wy * wa;
    }

    // Hills
    const hills = noise?.hills ?? {};
    const hn = this.noise.fractal2(
      sx * (hills.frequency ?? 0) + (hills.offset?.[0] ?? 0),
      sy * (hills.frequency ?? 0) + (hills.offset?.[1] ?? 0),
      { octaves: hills.octaves ?? 4, persistence: hills.persistence ?? 0.55, lacunarity: hills.lacunarity ?? 2.1 }
    );
    let height = hn * (hills.amplitude ?? 55);

    // Mountains
    const m = noise?.mountains ?? {};
    const mn = this.noise.fractal2(
      sx * (m.frequency ?? 0) + (m.offset?.[0] ?? 0),
      sy * (m.frequency ?? 0) + (m.offset?.[1] ?? 0),
      { octaves: m.octaves ?? 5, persistence: m.persistence ?? 0.52, lacunarity: m.lacunarity ?? 2.05 }
    );
    if ((m.amplitude ?? 0) !== 0){
      const exp = m.exponent ?? 1;
      const strength = Math.pow(Math.max(0, mn), exp);
      height += strength * (m.amplitude ?? 0);
    }

    // Ridges
    const r = noise?.ridges ?? {};
    if ((r.amplitude ?? 0) !== 0){
      const rb = this.noise.perlin2(sx * (r.frequency ?? 0) + (r.offset?.[0] ?? 0), sy * (r.frequency ?? 0) + (r.offset?.[1] ?? 0));
      const rexp = r.exponent ?? 1;
      const rstr = Math.pow(Math.abs(rb * 2 - 1), rexp);
      height += rstr * (r.amplitude ?? 0);
    }

    // Fine detail
    const d = noise?.detail;
    if (d && (d.amplitude ?? 0) !== 0){
      const dn = this.noise.fractal2(
        sx * (d.frequency ?? 0), sy * (d.frequency ?? 0),
        { octaves: d.octaves ?? 3, persistence: d.persistence ?? 0.45, lacunarity: d.lacunarity ?? 2.4 }
      );
      height += dn * (d.amplitude ?? 0);
    }

    // Plateau
    const p = plateau ?? {};
    const distance = Math.sqrt(sx * sx + sy * sy);
    const flatRadius = p.flatRadius ?? 160;
    const blendRadius = p.blendRadius ?? 340;
    if (distance < blendRadius){
      const t = THREE.MathUtils.clamp((distance - flatRadius) / Math.max(1, blendRadius - flatRadius), 0, 1);
      height = THREE.MathUtils.lerp(p.height ?? 8, height, t);
    }

    return height;
  }

  // crater shaping contribution for many scattered craters
  _craterContribution(worldX, worldY){
    const c = this.craterCfg;
    if (!c?.enabled) return 0;

    const S = Math.max(200, c.spacing | 0);
    // find cell index
    const cx = Math.floor(worldX / S);
    const cy = Math.floor(worldY / S);

    let contrib = 0;
    // check this cell + neighbors to cover edge overlaps
    for (let ox = -1; ox <= 1; ox++){
      for (let oy = -1; oy <= 1; oy++){
        const ix = cx + ox;
        const iy = cy + oy;
        const cellRng = rngFromCell(ix, iy, this.seed ^ 0x6b33);
        if (cellRng() > (c.chance ?? 0.22)) continue;

        // pick center within cell with jitter
        const j = c.jitter ?? 0.42;
        const centerX = (ix + 0.5 + (cellRng() - 0.5) * j) * S;
        const centerY = (iy + 0.5 + (cellRng() - 0.5) * j) * S;

        const rmin = c.radius?.[0] ?? 120;
        const rmax = c.radius?.[1] ?? 340;
        const R = rmin + cellRng() * (rmax - rmin);

        const dmin = c.depth?.[0] ?? 20;
        const dmax = c.depth?.[1] ?? 120;
        const depth = dmin + cellRng() * (dmax - dmin);

        const dx = worldX - centerX;
        const dy = worldY - centerY;
        const r = Math.hypot(dx, dy);
        if (r > R) continue;

        const t = 1 - r / Math.max(1, R);
        const rimSharp = c.rimSharpness ?? 1.8;
        // parabolic bowl; negative contribution (carve down)
        contrib -= Math.pow(t, rimSharp) * depth;
      }
    }
    return contrib;
  }

  _sampleHeight(worldX, worldY){
    // base terrain
    let height = this._sampleHeightBase(worldX, worldY);

    // many small/medium craters
    height += this._craterContribution(worldX, worldY);

    // mega volcano shaping
    const v = this.volcano;
    if (v?.enabled && this._volcanoHasCenter){
      const cx = v.center[0] ?? 0;
      const cy = v.center[1] ?? 0;
      const dx = worldX - cx;
      const dy = worldY - cy;
      const r = Math.hypot(dx, dy);
      const R = v.baseRadius ?? 1100;
      if (r <= R){
        const rimSharp = v.rimSharpness ?? 2.2;
        const t = THREE.MathUtils.clamp(1 - r / Math.max(1, R), 0, 1);
        let add = Math.pow(t, rimSharp) * (v.height ?? 820);
        // jaggedness
        const n = v.noise ?? {};
        if ((n.amplitude ?? 0) !== 0){
          const f = n.frequency ?? 0.003;
          const jag = this.noise.perlin2(worldX * f, worldY * f) * 2 - 1;
          add += jag * (n.amplitude ?? 60) * t;
        }
        // crater bowl carve within volcano
        const rc = v.craterRadius ?? 220;
        if (r < rc){
          const craterT = 1 - r / Math.max(1, rc);
          const depth = v.craterDepth ?? 180;
          const carve = (craterT * craterT) * depth;
          add -= carve;
          add += (v.floorLift ?? 40) * (1 - craterT);
        }
        height += add;
      }
    }

    return height;
  }

  _slopeMagnitude(worldX, worldY){
    const delta = 2;
    const center = this._sampleHeight(worldX, worldY);
    const dx = this._sampleHeight(worldX + delta, worldY) - center;
    const dy = this._sampleHeight(worldX, worldY + delta) - center;
    return Math.sqrt(dx * dx + dy * dy) / delta;
  }

  // ----------------- BIOME & COLOR -----------------
  _sampleClimate(worldX, worldY){
    const c = this.generatorConfig.climate ?? {};
    const t = c.temperature ?? null;
    const m = c.moisture ?? null;
    const temp = t ? (this.noise.perlin2(worldX * (t.frequency ?? 0) + (t.offset?.[0] ?? 0), worldY * (t.frequency ?? 0) + (t.offset?.[1] ?? 0)) * 2 - 1) : 0;
    const moist = m ? (this.noise.perlin2(worldX * (m.frequency ?? 0) + (m.offset?.[0] ?? 0), worldY * (m.frequency ?? 0) + (m.offset?.[1] ?? 0)) * 2 - 1) : 0;
    return { temp, moist };
  }

  _pickBiome(height, temp, moist){
    const rules = this.generatorConfig.biomes?.rules;
    if (Array.isArray(rules) && rules.length){
      for (const r of rules){
        const w = r.when ?? {};
        if (w.default) return r.name;
        if (w.heightBelow != null && !(height < w.heightBelow)) continue;
        if (w.heightAbove != null && !(height > w.heightAbove)) continue;
        if (w.heightBetween && !(height >= w.heightBetween[0] && height <= w.heightBetween[1])) continue;
        if (w.temperatureBelow != null && !(temp < w.temperatureBelow)) continue;
        if (w.temperatureAbove != null && !(temp > w.temperatureAbove)) continue;
        if (w.moistureBelow != null && !(moist < w.moistureBelow)) continue;
        if (w.moistureAbove != null && !(moist > w.moistureAbove)) continue;
        return r.name;
      }
    }
    // fallback: ocean/beach/snow/grass from world settings
    if (height < this.world.waterLevel) return 'ocean';
    if (height < this.world.waterLevel + this.world.beachBand) return 'beach';
    if (height > this.world.snowline) return 'snow';
    return 'grass';
  }

  _sampleBiomeColor(worldX, worldY, height){
    // If ramps exist, use them; else fallback to old low/mid/high gradient
    if (this._ramps){
      const { temp, moist } = this._sampleClimate(worldX, worldY);
      const biome = this._pickBiome(height, temp, moist);
      const ramp = this._ramps[biome];
      if (ramp){
        // map height into a simple local range per biome
        let t = 0.5;
        if (biome === 'ocean'){
          const wl = this.world.waterLevel;
          t = THREE.MathUtils.clamp( (height - (wl - 40)) / 40, 0, 1 );
        } else if (biome === 'beach'){
          t = THREE.MathUtils.clamp( (height - this.world.waterLevel) / Math.max(1, this.world.beachBand), 0, 1 );
        } else if (biome === 'snow'){
          t = THREE.MathUtils.clamp( (height - this.world.snowline) / 100, 0, 1 );
        } else {
          // generic: scale between lowThreshold and highCap
          const lo = this._colorGradient.lowThreshold, hi = this._colorGradient.highCap;
          t = THREE.MathUtils.clamp((height - lo) / Math.max(1, hi - lo), 0, 1);
        }
        return lerpColorStops(ramp, t);
      }
    }
    // fallback legacy gradient
    return this._sampleColorLegacy(height);
  }

  _sampleColorLegacy(height){
    const g = this._colorGradient;
    if (height < g.lowThreshold) return g.low.clone();
    if (height < g.highThreshold){
      const t = THREE.MathUtils.clamp((height - g.lowThreshold) / Math.max(1, g.highThreshold - g.lowThreshold), 0, 1);
      return g.low.clone().lerp(g.mid, t);
    }
    const t = THREE.MathUtils.clamp((height - g.highThreshold) / Math.max(1, (g.highCap) - g.highThreshold), 0, 1);
    return g.mid.clone().lerp(g.high, t);
  }

  // ----------------- Volcano visuals (lava disk) -----------------
  _addVolcanoLavaIfNeeded({ chunkX, chunkY, group }){
    const v = this.volcano;
    if (!v?.enabled || !this._volcanoHasCenter) return;
    if (group.userData.__lavaAdded) return;

    const cx = v.center[0] ?? 0;
    const cy = v.center[1] ?? 0;

    // is the center in this chunk?
    const x0 = chunkX * this.chunkSize;
    const y0 = chunkY * this.chunkSize;
    const x1 = x0 + this.chunkSize;
    const y1 = y0 + this.chunkSize;
    if (cx < x0 || cx >= x1 || cy < y0 || cy >= y1) return;

    // sample height at center (with volcano shaping) and place lava a bit lower
    const craterHeight = this._sampleHeight(cx, cy);
    const lavaLevel = craterHeight + (v.lava?.levelOffset ?? -12);

    const radius = (v.craterRadius ?? 220) * 0.92;
    const geo = new THREE.CircleGeometry(radius, 48);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(v.lava?.color ?? '#ff5a1f'),
      emissive: new THREE.Color(v.lava?.emissive ?? '#ff8a00'),
      emissiveIntensity: v.lava?.emissiveIntensity ?? 1.6,
      roughness: 0.35,
      metalness: 0.1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx - x0, cy - y0, lavaLevel);
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.name = 'VolcanoLava';
    group.add(mesh);

    (this.disposables ?? (this.disposables = [])).push(mat);
    group.userData.__lavaAdded = true;
  }
}
