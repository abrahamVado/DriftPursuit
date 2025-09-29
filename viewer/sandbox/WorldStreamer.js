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

export class WorldStreamer {
  constructor({ scene, chunkSize = 600, radius = 3, seed = 1337 } = {}){
    this.scene = scene;
    this.chunkSize = chunkSize;
    this.radius = radius;
    this.seed = seed;
    this.noise = new NoiseGenerator(seed);
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

    this._maybeAddMountain({ chunkX, chunkY, rng, group, obstacles });
    this._scatterRocks({ chunkX, chunkY, rng, group, obstacles });
    this._maybeAddTown({ chunkX, chunkY, rng, group, obstacles });
    this._maybeAddRiver({ chunkX, chunkY, rng, group });

    return { obstacles };
  }

  _maybeAddMountain({ chunkX, chunkY, rng, group, obstacles }){
    const centerX = (chunkX + 0.5) * this.chunkSize;
    const centerY = (chunkY + 0.5) * this.chunkSize;
    const mountainNoise = this.noise.fractal2(centerX * 0.00032 + 300, centerY * 0.00032 - 220, { octaves: 5, persistence: 0.58, lacunarity: 2.18 });
    if (mountainNoise < 0.64) return;

    const clusterCount = mountainNoise > 0.78 ? 2 : 1;
    for (let c = 0; c < clusterCount; c += 1){
      const location = this._findLocation({ chunkX, chunkY, rng, attempts: 10, minHeight: 120, maxSlope: 0.55 });
      if (!location) break;

      const baseHeight = location.height;
      const heightGain = 120 + rng() * 220;
      const radius = 60 + rng() * 90;
      const segments = 8 + Math.floor(rng() * 4);
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
      });
    }
  }

  _scatterRocks({ chunkX, chunkY, rng, group, obstacles }){
    const centerX = (chunkX + 0.5) * this.chunkSize;
    const centerY = (chunkY + 0.5) * this.chunkSize;
    const rockDensity = this.noise.perlin2(centerX * 0.0014 + 1200, centerY * 0.0014 - 860);
    const count = Math.floor(2 + rockDensity * 6);
    for (let i = 0; i < count; i += 1){
      const location = this._findLocation({ chunkX, chunkY, rng, attempts: 6, maxSlope: 0.45 });
      if (!location) break;
      const size = 6 + rng() * 18;
      const detail = rng() > 0.55 ? 1 : 0;
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
      });
    }
  }

  _maybeAddTown({ chunkX, chunkY, rng, group, obstacles }){
    const centerX = (chunkX + 0.5) * this.chunkSize;
    const centerY = (chunkY + 0.5) * this.chunkSize;
    const settlementNoise = this.noise.fractal2(centerX * 0.00022 + 1480, centerY * 0.00022 - 930, { octaves: 4, persistence: 0.6, lacunarity: 2.3 });
    if (settlementNoise < 0.66) return;

    const anchor = this._findLocation({ chunkX, chunkY, rng, attempts: 12, maxSlope: 0.18, maxHeight: 180 });
    if (!anchor) return;

    const townGroup = new THREE.Group();
    townGroup.name = `Town_${chunkX}_${chunkY}`;
    group.add(townGroup);

    const plazaRadius = 16 + rng() * 10;
    const plazaGeometry = new THREE.CircleGeometry(plazaRadius, 24);
    const plaza = new THREE.Mesh(plazaGeometry, this.materials.plaza);
    plaza.position.set(anchor.localX, anchor.localY, anchor.height + 0.4);
    plaza.receiveShadow = true;
    townGroup.add(plaza);

    const buildingCount = 4 + Math.floor(rng() * 5);
    for (let i = 0; i < buildingCount; i += 1){
      const angle = rng() * Math.PI * 2;
      const distance = plazaRadius + 8 + rng() * 35;
      const worldX = anchor.worldX + Math.cos(angle) * distance;
      const worldY = anchor.worldY + Math.sin(angle) * distance;
      const slope = this._slopeMagnitude(worldX, worldY);
      if (slope > 0.24) continue;
      const height = this._sampleHeight(worldX, worldY);
      const width = 12 + rng() * 14;
      const depth = 10 + rng() * 18;
      const wallHeight = 12 + rng() * 10;
      const roofHeight = wallHeight * 0.6;

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
      });
    }
  }

  _maybeAddRiver({ chunkX, chunkY, rng, group }){
    const centerX = (chunkX + 0.5) * this.chunkSize;
    const centerY = (chunkY + 0.5) * this.chunkSize;
    const riverNoise = this.noise.perlin2(centerX * 0.00038 - 510, centerY * 0.00038 + 740) - 0.5;
    const closeness = Math.abs(riverNoise);
    if (closeness > 0.085) return;

    const angleNoise = this.noise.perlin2(centerX * 0.00062 + 2200, centerY * 0.00062 - 1800);
    const angle = angleNoise * Math.PI * 2;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const perpX = -dirY;
    const perpY = dirX;
    const length = this.chunkSize * 1.5;
    const width = THREE.MathUtils.lerp(26, 58, 1 - THREE.MathUtils.clamp(closeness / 0.085, 0, 1));
    const halfWidth = width / 2;
    const segments = 18;

    const positions = new Float32Array((segments + 1) * 2 * 3);
    const indices = [];

    for (let i = 0; i <= segments; i += 1){
      const t = (i / segments - 0.5) * length;
      const meander = (this.noise.perlin2(centerX * 0.0012 + t * 0.002, centerY * 0.0012 - t * 0.002) - 0.5) * width * 0.6;
      const centerWorldX = centerX + dirX * t + perpX * meander;
      const centerWorldY = centerY + dirY * t + perpY * meander;
      for (let side = 0; side < 2; side += 1){
        const sign = side === 0 ? -1 : 1;
        const worldX = centerWorldX + perpX * sign * halfWidth;
        const worldY = centerWorldY + perpY * sign * halfWidth;
        const height = this._sampleHeight(worldX, worldY) - 2.8;
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
    const hills = this.noise.fractal2(worldX * 0.0012, worldY * 0.0012, { octaves: 4, persistence: 0.55, lacunarity: 2.1 });
    const mountains = this.noise.fractal2(worldX * 0.00045 + 40, worldY * 0.00045 - 60, { octaves: 5, persistence: 0.52, lacunarity: 2.05 });
    const ridges = Math.pow(Math.abs(this.noise.perlin2(worldX * 0.0025, worldY * 0.0025) * 2 - 1), 1.6);
    let height = hills * 55 + Math.pow(mountains, 3.2) * 340 + ridges * 20;

    const distance = Math.sqrt(worldX * worldX + worldY * worldY);
    const flatRadius = 160;
    const blendRadius = 340;
    if (distance < blendRadius){
      const t = THREE.MathUtils.clamp((distance - flatRadius) / Math.max(1, blendRadius - flatRadius), 0, 1);
      height = THREE.MathUtils.lerp(8, height, t);
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
    const low = new THREE.Color(0x2f5b2f);
    const mid = new THREE.Color(0x4e7741);
    const high = new THREE.Color(0xc2c5c7);
    if (height < 30){
      return low.clone();
    }
    if (height < 140){
      const t = THREE.MathUtils.clamp((height - 30) / 110, 0, 1);
      return low.clone().lerp(mid, t);
    }
    const t = THREE.MathUtils.clamp((height - 140) / 160, 0, 1);
    return mid.clone().lerp(high, t);
  }
}
