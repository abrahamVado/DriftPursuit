import { NoiseGenerator } from './Noise.js';

const THREE = (typeof window !== 'undefined' ? window.THREE : globalThis?.THREE) ?? null;
if (!THREE) throw new Error('Sandbox WorldStreamer requires THREE to be loaded globally');


function chunkKey(x, y){
  return `${x}:${y}`;
}

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

const DEFAULT_GENERATOR_CONFIG = {
  noise: {
    hills: { frequency: 0.0012, offset: [0, 0], octaves: 4, persistence: 0.55, lacunarity: 2.1, amplitude: 55, exponent: 1 },
    mountains: {
      frequency: 0.00045,
      offset: [40, -60],
      octaves: 5,
      persistence: 0.52,
      lacunarity: 2.05,
      amplitude: 340,
      exponent: 3.2,
    },
    ridges: { frequency: 0.0025, offset: [0, 0], amplitude: 20, exponent: 1.6 },
  },
  plateau: { flatRadius: 160, blendRadius: 340, height: 8 },
  features: { mountains: true, rocks: true, towns: true, rivers: true },
  colors: {
    low: '#2f5b2f',
    mid: '#4e7741',
    high: '#c2c5c7',
    lowThreshold: 30,
    highThreshold: 140,
    highCap: 300,
  },
  mountains: {
    noise: { frequency: 0.00032, offset: [300, -220], octaves: 5, persistence: 0.58, lacunarity: 2.18 },
    threshold: 0.64,
    clusterThreshold: 0.78,
    clusterCount: 2,
    minHeight: 120,
    maxSlope: 0.55,
    heightGain: { min: 120, max: 340 },
    radius: { min: 60, max: 150 },
    segments: { min: 8, max: 12 },
  },
  rocks: {
    noise: { frequency: 0.0014, offset: [1200, -860] },
    baseCount: 2,
    densityScale: 6,
    attempts: 6,
    maxSlope: 0.45,
    size: { min: 6, max: 24 },
    detailThreshold: 0.55,
  },
  towns: {
    noise: { frequency: 0.00022, offset: [1480, -930], octaves: 4, persistence: 0.6, lacunarity: 2.3 },
    threshold: 0.66,
    anchor: { attempts: 12, maxSlope: 0.18, maxHeight: 180 },
    plazaRadius: { min: 16, max: 26 },
    buildingCount: { min: 4, max: 8 },
    buildingDistance: { offset: 8, range: 35 },
    buildingWidth: { min: 12, max: 26 },
    buildingDepth: { min: 10, max: 28 },
    wallHeight: { min: 12, max: 22 },
    roofHeightScale: 0.6,
    buildingPlacementMaxSlope: 0.24,
  },
  rivers: {
    noise: { frequency: 0.00038, offset: [-510, 740] },
    threshold: 0.085,
    lengthMultiplier: 1.5,
    width: { min: 26, max: 58 },
    meander: { frequency: 0.0012, scale: 0.6 },
    angleNoise: { frequency: 0.00062, offset: [2200, -1800] },
    depth: 2.8,
    segments: 18,
  },
};

function cloneGeneratorValue(value){
  if (Array.isArray(value)){
    return value.map((item) => cloneGeneratorValue(item));
  }
  if (value && typeof value === 'object'){
    const clone = {};
    for (const key of Object.keys(value)){
      clone[key] = cloneGeneratorValue(value[key]);
    }
    return clone;
  }
  return value;
}

function mergeGeneratorConfig(base, override){
  if (!override || typeof override !== 'object'){
    return cloneGeneratorValue(base);
  }
  const result = Array.isArray(base) ? [] : {};
  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(override ?? {})]);
  keys.forEach((key) => {
    const baseValue = base?.[key];
    const overrideValue = override?.[key];
    if (Array.isArray(baseValue)){
      result[key] = Array.isArray(overrideValue) ? cloneGeneratorValue(overrideValue) : cloneGeneratorValue(baseValue);
    } else if (baseValue && typeof baseValue === 'object'){
      result[key] = mergeGeneratorConfig(baseValue, overrideValue);
    } else if (overrideValue && typeof overrideValue === 'object'){
      result[key] = cloneGeneratorValue(overrideValue);
    } else {
      result[key] = overrideValue ?? baseValue;
    }
  });
  return result;
}

export class WorldStreamer {
  constructor({ scene, chunkSize = 600, radius = 3, seed = 1337, generator = null, procedural = null } = {}){
    this.scene = scene;
    this.chunkSize = chunkSize;
    this.radius = radius;
    this.seed = seed;
    this.noise = new NoiseGenerator(seed);
    const overrides = generator ?? procedural ?? null;
    this.generatorConfig = mergeGeneratorConfig(DEFAULT_GENERATOR_CONFIG, overrides);
    this._colorGradient = {
      low: new THREE.Color(this.generatorConfig.colors.low),
      mid: new THREE.Color(this.generatorConfig.colors.mid),
      high: new THREE.Color(this.generatorConfig.colors.high),
    };
    this.worldGroup = new THREE.Group();
    this.worldGroup.name = 'EndlessTerrain';
    this.originOffset = new THREE.Vector3();
    this.chunkMap = new Map();
    this.disposables = [];
    this.materials = this._createSharedMaterials();
    this.sharedMaterials = new Set(Object.values(this.materials));
    this.disposables.push(...this.sharedMaterials);
    this.scene?.add(this.worldGroup);
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
  }

  handleOriginShift(shift){
    if (!shift) return;
    this.originOffset.add(shift);
    this.chunkMap.forEach((chunk) => {
      if (chunk?.group){
        chunk.group.position.sub(shift);
      }
    });
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
          chunk.obstacles.forEach((obstacle) => {
            const dxWorld = obstacle.worldPosition.x - globalX;
            const dyWorld = obstacle.worldPosition.y - globalY;
            const horizontalSq = dxWorld * dxWorld + dyWorld * dyWorld;
            if (horizontalSq <= (radius + obstacle.radius) * (radius + obstacle.radius)){
              results.push(obstacle);
            }
          });
        }
      }
    }
    return results;
  }

  dispose(){
    this.chunkMap.forEach((chunk) => this._disposeChunk(chunk));
    this.chunkMap.clear();
    if (this.scene){
      this.scene.remove(this.worldGroup);
    }
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
    const resolution = 64;
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
      const color = this._sampleColor(height);
      colors[colorIndex] = color.r;
      colors[colorIndex + 1] = color.g;
      colors[colorIndex + 2] = color.b;
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

  _disposeMaterialIfOwned(material){
    if (!material) return;
    if (Array.isArray(material)){
      material.forEach((mat) => this._disposeMaterialIfOwned(mat));
      return;
    }
    if (this.sharedMaterials?.has(material)) return;
    material.dispose?.();
  }

  _scatterTerrainFeatures({ chunkX, chunkY, rng, group }){
    const obstacles = [];

    const features = this.generatorConfig.features ?? {};
    if (features.mountains !== false){
      this._maybeAddMountain({ chunkX, chunkY, rng, group, obstacles });
    }
    if (features.rocks !== false){
      this._scatterRocks({ chunkX, chunkY, rng, group, obstacles });
    }
    if (features.towns !== false){
      this._maybeAddTown({ chunkX, chunkY, rng, group, obstacles });
    }
    if (features.rivers !== false){
      this._maybeAddRiver({ chunkX, chunkY, rng, group });
    }

    return { obstacles };
  }

  _maybeAddMountain({ chunkX, chunkY, rng, group, obstacles }){
    const centerX = (chunkX + 0.5) * this.chunkSize;
    const centerY = (chunkY + 0.5) * this.chunkSize;
    const config = this.generatorConfig.mountains ?? {};
    const noiseCfg = config.noise ?? {};
    const noise = this.noise.fractal2(
      centerX * (noiseCfg.frequency ?? 0) + (noiseCfg.offset?.[0] ?? 0),
      centerY * (noiseCfg.frequency ?? 0) + (noiseCfg.offset?.[1] ?? 0),
      {
        octaves: noiseCfg.octaves ?? 5,
        persistence: noiseCfg.persistence ?? 0.58,
        lacunarity: noiseCfg.lacunarity ?? 2.18,
      },
    );
    const threshold = config.threshold ?? 0.64;
    if (noise < threshold) return;

    const clusterThreshold = config.clusterThreshold ?? threshold + 0.14;
    const maxClusters = Math.max(1, Math.round(config.clusterCount ?? 2));
    const clusterCount = noise > clusterThreshold ? maxClusters : 1;
    const attempts = config.locationAttempts ?? 10;
    for (let c = 0; c < clusterCount; c += 1){
      const location = this._findLocation({
        chunkX,
        chunkY,
        rng,
        attempts,
        minHeight: config.minHeight ?? 120,
        maxSlope: config.maxSlope ?? 0.55,
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
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(location.localX, location.localY, baseHeight + heightGain / 2);
      group.add(mesh);

      const peakHeight = baseHeight + heightGain;
      obstacles.push({
        mesh,
        radius: radius * 0.95,
        worldPosition: new THREE.Vector3(location.worldX, location.worldY, peakHeight),
        topHeight: peakHeight,
        baseHeight,
        type: 'mountain',
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
        chunkX,
        chunkY,
        rng,
        attempts: config.attempts ?? 6,
        maxSlope: config.maxSlope ?? 0.45,
      });
      if (!location) break;
      const sizeMin = config.size?.min ?? 6;
      const sizeMax = config.size?.max ?? 24;
      const size = sizeMin + rng() * Math.max(0, sizeMax - sizeMin);
      const detailThreshold = config.detailThreshold ?? 0.55;
      const detail = rng() > detailThreshold ? 1 : 0;
      const geometry = new THREE.DodecahedronGeometry(size, detail);
      const mesh = new THREE.Mesh(geometry, this.materials.rock);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(location.localX, location.localY, location.height + size * 0.45);
      group.add(mesh);

      obstacles.push({
        mesh,
        radius: size * 0.8,
        worldPosition: new THREE.Vector3(location.worldX, location.worldY, location.height + size),
        topHeight: location.height + size * 1.2,
        baseHeight: location.height,
        type: 'rock',
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
      {
        octaves: noiseCfg.octaves ?? 4,
        persistence: noiseCfg.persistence ?? 0.6,
        lacunarity: noiseCfg.lacunarity ?? 2.3,
      },
    );
    if (settlementNoise < (config.threshold ?? 0.66)) return;

    const anchorCfg = config.anchor ?? {};
    const anchor = this._findLocation({
      chunkX,
      chunkY,
      rng,
      attempts: anchorCfg.attempts ?? 12,
      maxSlope: anchorCfg.maxSlope ?? 0.18,
      maxHeight: anchorCfg.maxHeight ?? 180,
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
      base.castShadow = true;
      base.receiveShadow = true;
      townGroup.add(base);

      const roofRadius = Math.max(width, depth) * 0.75;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(roofRadius, roofHeight, 4), this.materials.roof);
      roof.position.set(localX, localY, height + wallHeight + roofHeight / 2);
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      roof.receiveShadow = true;
      townGroup.add(roof);

      obstacles.push({
        mesh: base,
        radius: Math.max(width, depth) * 0.6,
        worldPosition: new THREE.Vector3(worldX, worldY, height + wallHeight),
        topHeight: height + wallHeight + roofHeight,
        baseHeight: height,
        type: 'building',
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
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, d, a, d, c);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, this.materials.water);
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    group.add(mesh);
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

  _sampleHeight(worldX, worldY){
    const { noise, plateau } = this.generatorConfig;
    const hillsSettings = noise?.hills ?? {};
    const hillsFreq = hillsSettings.frequency ?? 0;
    const hillsOffsetX = hillsSettings.offset?.[0] ?? 0;
    const hillsOffsetY = hillsSettings.offset?.[1] ?? 0;
    const hillsNoise = this.noise.fractal2(
      worldX * hillsFreq + hillsOffsetX,
      worldY * hillsFreq + hillsOffsetY,
      {
        octaves: hillsSettings.octaves ?? 4,
        persistence: hillsSettings.persistence ?? 0.55,
        lacunarity: hillsSettings.lacunarity ?? 2.1,
      },
    );
    let height = hillsNoise * (hillsSettings.amplitude ?? 55);

    const mountainSettings = noise?.mountains ?? {};
    const mountainFreq = mountainSettings.frequency ?? 0;
    const mountainOffsetX = mountainSettings.offset?.[0] ?? 0;
    const mountainOffsetY = mountainSettings.offset?.[1] ?? 0;
    const mountainNoise = this.noise.fractal2(
      worldX * mountainFreq + mountainOffsetX,
      worldY * mountainFreq + mountainOffsetY,
      {
        octaves: mountainSettings.octaves ?? 5,
        persistence: mountainSettings.persistence ?? 0.52,
        lacunarity: mountainSettings.lacunarity ?? 2.05,
      },
    );
    const mountainExponent = mountainSettings.exponent ?? 1;
    const mountainAmplitude = mountainSettings.amplitude ?? 0;
    if (mountainAmplitude !== 0){
      const strength = Math.pow(Math.max(0, mountainNoise), mountainExponent);
      height += strength * mountainAmplitude;
    }

    const ridgeSettings = noise?.ridges ?? {};
    const ridgeFreq = ridgeSettings.frequency ?? 0;
    const ridgeOffsetX = ridgeSettings.offset?.[0] ?? 0;
    const ridgeOffsetY = ridgeSettings.offset?.[1] ?? 0;
    const ridgeBase = this.noise.perlin2(worldX * ridgeFreq + ridgeOffsetX, worldY * ridgeFreq + ridgeOffsetY);
    const ridgeExponent = ridgeSettings.exponent ?? 1;
    const ridgeAmplitude = ridgeSettings.amplitude ?? 0;
    if (ridgeAmplitude !== 0){
      const ridgeStrength = Math.pow(Math.abs(ridgeBase * 2 - 1), ridgeExponent);
      height += ridgeStrength * ridgeAmplitude;
    }

    const plateauSettings = plateau ?? {};
    const distance = Math.sqrt(worldX * worldX + worldY * worldY);
    const flatRadius = plateauSettings.flatRadius ?? 160;
    const blendRadius = plateauSettings.blendRadius ?? 340;
    if (distance < blendRadius){
      const t = THREE.MathUtils.clamp((distance - flatRadius) / Math.max(1, blendRadius - flatRadius), 0, 1);
      height = THREE.MathUtils.lerp(plateauSettings.height ?? 8, height, t);
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

  _sampleColor(height){
    const colors = this.generatorConfig.colors ?? {};
    const lowThreshold = colors.lowThreshold ?? 30;
    const highThreshold = colors.highThreshold ?? 140;
    if (height < lowThreshold){
      return this._colorGradient.low.clone();
    }
    if (height < highThreshold){
      const t = THREE.MathUtils.clamp((height - lowThreshold) / Math.max(1, highThreshold - lowThreshold), 0, 1);
      return this._colorGradient.low.clone().lerp(this._colorGradient.mid, t);
    }
    const t = THREE.MathUtils.clamp((height - highThreshold) / Math.max(1, (colors.highCap ?? highThreshold + 160) - highThreshold), 0, 1);
    return this._colorGradient.mid.clone().lerp(this._colorGradient.high, t);
  }
}
