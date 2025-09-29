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
  constructor({ scene, chunkSize = 600, radius = 2, seed = 1337 } = {}){
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

    const obstacles = this._scatterObstacles({ chunkX, chunkY, rng, group });

    return { coords, group, obstacles, terrain };
  }

  _disposeChunk(chunk){
    if (!chunk) return;
    if (chunk.group){
      this.worldGroup.remove(chunk.group);
      chunk.group.traverse((child) => {
        if (child.isMesh){
          child.geometry?.dispose?.();
          child.material?.dispose?.();
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

  _scatterObstacles({ chunkX, chunkY, rng, group }){
    const count = Math.floor(rng() * 4);
    const obstacles = [];
    for (let i = 0; i < count; i += 1){
      const localX = (rng() - 0.5) * this.chunkSize * 0.8;
      const localY = (rng() - 0.5) * this.chunkSize * 0.8;
      const worldX = chunkX * this.chunkSize + localX;
      const worldY = chunkY * this.chunkSize + localY;
      const baseHeight = this._sampleHeight(worldX, worldY);
      const steepness = this._slopeMagnitude(worldX, worldY);
      if (steepness < 0.08) continue;
      const peakHeight = baseHeight + 40 + rng() * 80;
      const radius = 10 + rng() * 20;

      const geometry = new THREE.ConeGeometry(radius, peakHeight - baseHeight, 8);
      const material = new THREE.MeshStandardMaterial({ color: 0x9d9385, roughness: 0.7, metalness: 0.15 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(localX, localY, baseHeight + (peakHeight - baseHeight) / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);

      obstacles.push({
        mesh,
        radius: radius * 0.9,
        worldPosition: new THREE.Vector3(worldX, worldY, peakHeight / 2 + baseHeight / 2),
        topHeight: peakHeight,
        baseHeight,
      });
    }
    return obstacles;
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
