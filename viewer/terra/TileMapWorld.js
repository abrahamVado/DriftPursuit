import { requireTHREE } from '../shared/threeSetup.js';

const THREE = requireTHREE();

function chunkKey(x, y){
  return `${x}:${y}`;
}

function toChunkCoord(worldCoord, chunkSize){
  return Math.floor((worldCoord + chunkSize * 0.5) / chunkSize);
}

function clamp(value, min, max){
  return Math.min(max, Math.max(min, value));
}

function resolveColor(input, fallback){
  if (typeof input === 'string') return input;
  if (typeof input === 'number') return `#${input.toString(16).padStart(6, '0')}`;
  if (Array.isArray(input)){
    return `#${input
      .slice(0, 3)
      .map((component) => clamp(Math.round(component), 0, 255).toString(16).padStart(2, '0'))
      .join('')}`;
  }
  if (input && typeof input === 'object'){ return input.hex ?? fallback ?? '#ffffff'; }
  return fallback ?? '#ffffff';
}

function normalizeHeightfield(descriptor, elevation){
  const rows = Number(descriptor?.rows ?? descriptor?.height);
  const cols = Number(descriptor?.cols ?? descriptor?.width);
  const dataArray = Array.isArray(descriptor?.data) ? descriptor.data : null;
  if (!rows || !cols || !dataArray || dataArray.length !== rows * cols){
    console.warn('TileMapWorld: invalid heightfield descriptor; expected rows*cols samples', descriptor);
    return null;
  }
  const data = new Float32Array(rows * cols);
  for (let i = 0; i < data.length; i += 1){
    const value = Number(dataArray[i]);
    data[i] = Number.isFinite(value) ? value : 0;
  }
  const scaleDescriptor = descriptor.scale ?? descriptor.metersPerSample ?? descriptor.heightScale ?? descriptor.scaleZ ?? 1;
  let scaleZ = 1;
  if (typeof scaleDescriptor === 'number'){
    scaleZ = scaleDescriptor;
  } else if (Array.isArray(scaleDescriptor)){
    scaleZ = Number(scaleDescriptor[2]) || Number(scaleDescriptor[0]) || 1;
  } else if (scaleDescriptor && typeof scaleDescriptor === 'object'){
    scaleZ = Number(scaleDescriptor.z ?? scaleDescriptor[2]) || 1;
  }

  return {
    rows,
    cols,
    data,
    scaleZ,
    elevation,
    material: descriptor.material ? { ...descriptor.material } : null,
  };
}

function makeHeightSampler(heightfield, chunkSize){
  if (!heightfield){
    const base = 0;
    return () => base;
  }
  const { rows, cols, data, scaleZ, elevation } = heightfield;
  const maxRow = rows - 1;
  const maxCol = cols - 1;
  const invChunk = 1 / chunkSize;
  return (localX, localY) => {
    const u = clamp(localX * invChunk + 0.5, 0, 1);
    const v = clamp(0.5 - localY * invChunk, 0, 1);
    const column = clamp(u * maxCol, 0, maxCol);
    const row = clamp(v * maxRow, 0, maxRow);
    const col0 = Math.floor(column);
    const row0 = Math.floor(row);
    const col1 = clamp(col0 + 1, 0, maxCol);
    const row1 = clamp(row0 + 1, 0, maxRow);
    const fx = column - col0;
    const fy = row - row0;

    const index = (r, c) => r * cols + c;
    const h00 = elevation + data[index(row0, col0)] * scaleZ;
    const h10 = elevation + data[index(row0, col1)] * scaleZ;
    const h01 = elevation + data[index(row1, col0)] * scaleZ;
    const h11 = elevation + data[index(row1, col1)] * scaleZ;
    const hx0 = h00 * (1 - fx) + h10 * fx;
    const hx1 = h01 * (1 - fx) + h11 * fx;
    return hx0 * (1 - fy) + hx1 * fy;
  };
}

function createGroundPlane({ chunkSize, color, elevation = 0 }){
  const geometry = new THREE.PlaneGeometry(chunkSize, chunkSize, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(resolveColor(color, '#6a8b5d')),
    roughness: 0.85,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0, elevation);
  mesh.receiveShadow = true;
  const sampler = () => elevation;
  return { mesh, geometry, material, sampler };
}

function createHeightfieldMesh({ heightfield, chunkSize, color }){
  if (!heightfield) return null;
  const geometry = new THREE.PlaneGeometry(chunkSize, chunkSize, heightfield.cols - 1, heightfield.rows - 1);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i += 1){
    const heightValue = heightfield.data[i] ?? 0;
    positions.setZ(i, heightfield.elevation + heightValue * heightfield.scaleZ);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();

  const materialConfig = heightfield.material ?? {};
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(resolveColor(materialConfig.color, color ?? '#6f8560')),
    roughness: Number.isFinite(materialConfig.roughness) ? materialConfig.roughness : 0.78,
    metalness: Number.isFinite(materialConfig.metalness) ? materialConfig.metalness : 0.08,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return { mesh, geometry, material, sampler: makeHeightSampler(heightfield, chunkSize) };
}

function applyTransform(target, descriptor){
  if (!target || !descriptor) return;
  const position = Array.isArray(descriptor.position) ? descriptor.position : null;
  if (position){
    target.position.set(Number(position[0]) || 0, Number(position[1]) || 0, Number(position[2]) || 0);
  }
  const rotation = Array.isArray(descriptor.rotation) ? descriptor.rotation : null;
  const rotationDegrees = Array.isArray(descriptor.rotationDegrees) ? descriptor.rotationDegrees : null;
  if (rotation){
    target.rotation.set(Number(rotation[0]) || 0, Number(rotation[1]) || 0, Number(rotation[2]) || 0);
  } else if (rotationDegrees){
    const toRad = Math.PI / 180;
    target.rotation.set(
      (Number(rotationDegrees[0]) || 0) * toRad,
      (Number(rotationDegrees[1]) || 0) * toRad,
      (Number(rotationDegrees[2]) || 0) * toRad,
    );
  }
  const scale = descriptor.scale;
  if (Array.isArray(scale)){
    target.scale.set(Number(scale[0]) || 1, Number(scale[1]) || 1, Number(scale[2]) || 1);
  } else if (typeof scale === 'number'){
    target.scale.set(scale, scale, scale);
  }
}

function createTreeMesh(){
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.85, metalness: 0.1 });
  const canopyMaterial = new THREE.MeshStandardMaterial({ color: 0x3d6b3d, roughness: 0.8, metalness: 0.05 });
  const trunkGeometry = new THREE.CylinderGeometry(1.6, 2.2, 16, 8);
  const canopyGeometry = new THREE.ConeGeometry(8, 22, 10);
  const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  trunk.position.set(0, 0, 8);
  const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
  canopy.position.set(0, 0, 20);
  canopy.castShadow = true;
  canopy.receiveShadow = true;
  const group = new THREE.Group();
  group.add(trunk);
  group.add(canopy);
  return { object: group, disposables: [trunkGeometry, trunkMaterial, canopyGeometry, canopyMaterial], primaryMesh: canopy };
}

function createMapObject({ descriptor, chunkSize }){
  if (!descriptor) return null;
  const type = descriptor.type || descriptor.kind || 'box';
  const holder = new THREE.Group();
  const disposables = [];
  let primaryMesh = null;

  if (type === 'box'){
    const size = Array.isArray(descriptor.size) ? descriptor.size : [descriptor.width, descriptor.depth, descriptor.height];
    const width = Number(size?.[0] ?? descriptor.width ?? 40) || 40;
    const depth = Number(size?.[1] ?? descriptor.depth ?? 40) || 40;
    const height = Number(size?.[2] ?? descriptor.height ?? 20) || 20;
    const geometry = new THREE.BoxGeometry(width, depth, height);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(resolveColor(descriptor.color || descriptor.material?.color, '#8691a5')),
      roughness: Number(descriptor.material?.roughness ?? 0.6),
      metalness: Number(descriptor.material?.metalness ?? 0.2),
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = descriptor.castShadow !== false;
    mesh.receiveShadow = descriptor.receiveShadow !== false;
    mesh.position.set(0, 0, height / 2);
    holder.add(mesh);
    primaryMesh = mesh;
    disposables.push(geometry, material);
  } else if (type === 'cylinder' || type === 'tower'){
    const radiusTop = Number(descriptor.radiusTop ?? descriptor.radius ?? 8) || 8;
    const radiusBottom = Number(descriptor.radiusBottom ?? descriptor.radius ?? radiusTop) || radiusTop;
    const height = Number(descriptor.height ?? descriptor.size?.[2] ?? 30) || 30;
    const radialSegments = Math.max(3, Number(descriptor.radialSegments ?? 16) || 16);
    const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(resolveColor(descriptor.color || descriptor.material?.color, '#d6d0c2')),
      roughness: Number(descriptor.material?.roughness ?? 0.45),
      metalness: Number(descriptor.material?.metalness ?? 0.25),
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = descriptor.castShadow !== false;
    mesh.receiveShadow = descriptor.receiveShadow !== false;
    mesh.position.set(0, 0, height / 2);
    holder.add(mesh);
    primaryMesh = mesh;
    disposables.push(geometry, material);
  } else if (type === 'plane'){
    const size = Array.isArray(descriptor.size) ? descriptor.size : [descriptor.width, descriptor.depth];
    const width = Number(size?.[0] ?? descriptor.width ?? chunkSize * 0.5) || chunkSize * 0.5;
    const depth = Number(size?.[1] ?? descriptor.depth ?? chunkSize * 0.2) || chunkSize * 0.2;
    const geometry = new THREE.PlaneGeometry(width, depth, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(resolveColor(descriptor.color || descriptor.material?.color, '#dedede')),
      roughness: Number(descriptor.material?.roughness ?? 0.55),
      metalness: Number(descriptor.material?.metalness ?? 0.1),
      transparent: Boolean(descriptor.material?.transparent),
      opacity: Number(descriptor.material?.opacity ?? 1),
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = descriptor.receiveShadow !== false;
    mesh.castShadow = descriptor.castShadow === true;
    holder.add(mesh);
    primaryMesh = mesh;
    disposables.push(geometry, material);
  } else if (type === 'tree' || type === 'preset:tree'){
    const tree = createTreeMesh();
    holder.add(tree.object);
    primaryMesh = tree.primaryMesh;
    tree.disposables.forEach((resource) => disposables.push(resource));
  }

  if (holder.children.length === 0){
    return null;
  }

  applyTransform(holder, descriptor.transform || descriptor);
  holder.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(holder);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.sqrt((size.x * 0.5) ** 2 + (size.y * 0.5) ** 2);
  const obstacle = type === 'plane'
    ? null
    : {
      localPosition: center,
      radius: Math.max(1, radius),
      topHeight: bounds.max.z,
      baseHeight: bounds.min.z,
      mesh: primaryMesh,
      type,
    };

  return { object: holder, disposables, obstacle };
}

export class TileMapWorld {
  constructor({ scene, descriptor } = {}){
    this.scene = scene;
    this.descriptor = descriptor || {};
    this.chunkSize = Number(this.descriptor.tileSize) || 640;
    this.visibleRadius = Number(this.descriptor.visibleRadius) || 3;
    this.originOffset = new THREE.Vector3();
    this.sceneGroup = new THREE.Group();
    this.sceneGroup.name = `TileMapWorld_${this.descriptor.id || 'custom'}`;
    this.scene?.add(this.sceneGroup);

    this.tiles = new Map();
    this.chunkMap = new Map();
    this.fallbackHeight = Number(this.descriptor.fallback?.baseHeight ?? this.descriptor.fallback?.elevation ?? 0) || 0;
    this._tmpNormal = new THREE.Vector3(0, 0, 1);

    const tileEntries = Array.isArray(this.descriptor.tiles) ? this.descriptor.tiles : [];
    tileEntries.forEach((tile) => {
      const coords = Array.isArray(tile?.coords) ? tile.coords : Array.isArray(tile?.coordinates) ? tile.coordinates : null;
      if (!coords || coords.length < 2) return;
      const tileX = Number(coords[0]);
      const tileY = Number(coords[1]);
      if (!Number.isFinite(tileX) || !Number.isFinite(tileY)) return;
      const key = chunkKey(tileX, tileY);
      const elevation = Number(tile.baseHeight ?? tile.elevation ?? 0) || 0;
      const heightfield = tile.heightfield ? normalizeHeightfield(tile.heightfield, elevation) : null;
      const sampler = heightfield ? makeHeightSampler(heightfield, this.chunkSize) : () => elevation;
      this.tiles.set(key, {
        key,
        coords: { x: tileX, y: tileY },
        descriptor: tile,
        groundColor: tile.groundColor ?? this.descriptor.groundColor ?? '#6a8b5d',
        heightfield,
        heightSampler: sampler,
        elevation,
        objects: Array.isArray(tile.objects) ? tile.objects : [],
      });
    });
  }

  update(focusPosition){
    if (!focusPosition) return;
    const focusGlobalX = focusPosition.x + this.originOffset.x;
    const focusGlobalY = focusPosition.y + this.originOffset.y;
    const centerChunkX = toChunkCoord(focusGlobalX, this.chunkSize);
    const centerChunkY = toChunkCoord(focusGlobalY, this.chunkSize);
    const needed = new Set();

    for (let dx = -this.visibleRadius; dx <= this.visibleRadius; dx += 1){
      for (let dy = -this.visibleRadius; dy <= this.visibleRadius; dy += 1){
        const chunkX = centerChunkX + dx;
        const chunkY = centerChunkY + dy;
        const key = chunkKey(chunkX, chunkY);
        needed.add(key);
        if (!this.chunkMap.has(key)){
          const chunkEntry = this._spawnChunk(chunkX, chunkY);
          this.chunkMap.set(key, chunkEntry);
          if (chunkEntry?.group){
            this.sceneGroup.add(chunkEntry.group);
          }
        }
        const chunkEntry = this.chunkMap.get(key);
        this._positionChunk(chunkEntry);
      }
    }

    this.chunkMap.forEach((chunkEntry, key) => {
      if (!needed.has(key)){
        this._disposeChunk(chunkEntry);
        this.chunkMap.delete(key);
      }
    });
  }

  _spawnChunk(chunkX, chunkY){
    const key = chunkKey(chunkX, chunkY);
    const coords = { x: chunkX, y: chunkY };
    const tile = this.tiles.get(key);
    if (tile){
      const built = this._buildTileChunk(tile);
      return {
        key,
        coords,
        group: built.group,
        disposables: built.disposables,
        heightSampler: tile.heightSampler,
        obstacles: built.obstacles,
      };
    }

    const fallback = createGroundPlane({ chunkSize: this.chunkSize, color: '#6a8b5d', elevation: this.fallbackHeight });
    const group = new THREE.Group();
    group.name = `TileFallback_${chunkX}_${chunkY}`;
    group.add(fallback.mesh);
    return {
      key,
      coords,
      group,
      disposables: [fallback.geometry, fallback.material],
      heightSampler: fallback.sampler,
      obstacles: [],
    };
  }

  _buildTileChunk(tile){
    const group = new THREE.Group();
    group.name = `Tile_${tile.coords.x}_${tile.coords.y}`;
    const disposables = [];
    let heightSampler = tile.heightSampler;

    if (tile.heightfield){
      const heightMesh = createHeightfieldMesh({
        heightfield: tile.heightfield,
        chunkSize: this.chunkSize,
        color: tile.groundColor,
      });
      if (heightMesh){
        group.add(heightMesh.mesh);
        disposables.push(heightMesh.geometry, heightMesh.material);
        heightSampler = heightMesh.sampler;
      }
    } else {
      const ground = createGroundPlane({
        chunkSize: this.chunkSize,
        color: tile.groundColor,
        elevation: tile.elevation,
      });
      group.add(ground.mesh);
      disposables.push(ground.geometry, ground.material);
      heightSampler = ground.sampler;
    }

    const obstacles = [];
    tile.objects.forEach((objectDescriptor) => {
      const created = createMapObject({ descriptor: objectDescriptor, chunkSize: this.chunkSize });
      if (!created) return;
      group.add(created.object);
      created.disposables.forEach((resource) => {
        if (resource) disposables.push(resource);
      });
      if (created.obstacle){
        const local = created.obstacle.localPosition;
        const worldX = tile.coords.x * this.chunkSize + local.x;
        const worldY = tile.coords.y * this.chunkSize + local.y;
        const worldPosition = new THREE.Vector3(worldX, worldY, created.obstacle.topHeight);
        obstacles.push({
          mesh: created.obstacle.mesh ?? created.object,
          radius: created.obstacle.radius,
          topHeight: created.obstacle.topHeight,
          baseHeight: created.obstacle.baseHeight,
          worldPosition,
          type: created.obstacle.type || objectDescriptor.type || 'object',
        });
      }
    });

    return { group, disposables, heightSampler, obstacles };
  }

  _positionChunk(chunkEntry){
    if (!chunkEntry?.group) return;
    const worldX = chunkEntry.coords.x * this.chunkSize;
    const worldY = chunkEntry.coords.y * this.chunkSize;
    chunkEntry.group.position.set(
      worldX - this.originOffset.x,
      worldY - this.originOffset.y,
      -this.originOffset.z,
    );
  }

  _disposeChunk(chunkEntry){
    if (!chunkEntry) return;
    if (chunkEntry.group){
      this.sceneGroup.remove(chunkEntry.group);
      chunkEntry.group.traverse((child) => {
        if (child.isMesh){
          child.geometry?.dispose?.();
          if (child.material){
            if (Array.isArray(child.material)){
              child.material.forEach((mat) => mat?.dispose?.());
            } else {
              child.material.dispose?.();
            }
          }
        }
      });
      chunkEntry.group.clear();
    }
    if (Array.isArray(chunkEntry.disposables)){
      chunkEntry.disposables.forEach((resource) => resource?.dispose?.());
    }
  }

  getHeightAt(x, y){
    const worldX = x + this.originOffset.x;
    const worldY = y + this.originOffset.y;
    const chunkX = toChunkCoord(worldX, this.chunkSize);
    const chunkY = toChunkCoord(worldY, this.chunkSize);
    const key = chunkKey(chunkX, chunkY);
    const localX = worldX - chunkX * this.chunkSize;
    const localY = worldY - chunkY * this.chunkSize;

    const tile = this.tiles.get(key);
    if (tile?.heightSampler){
      return tile.heightSampler(localX, localY);
    }
    const chunk = this.chunkMap.get(key);
    if (chunk?.heightSampler){
      return chunk.heightSampler(localX, localY);
    }
    return this.fallbackHeight;
  }

  getOriginOffset(){
    return this.originOffset.clone();
  }

  getObstaclesNear(x, y, radius = this.chunkSize){
    const worldX = x + this.originOffset.x;
    const worldY = y + this.originOffset.y;
    const centerChunkX = toChunkCoord(worldX, this.chunkSize);
    const centerChunkY = toChunkCoord(worldY, this.chunkSize);
    const results = [];

    for (let dx = -1; dx <= 1; dx += 1){
      for (let dy = -1; dy <= 1; dy += 1){
        const chunkX = centerChunkX + dx;
        const chunkY = centerChunkY + dy;
        const key = chunkKey(chunkX, chunkY);
        const chunk = this.chunkMap.get(key);
        if (!chunk?.obstacles?.length) continue;
        chunk.obstacles.forEach((obstacle) => {
          const dxWorld = obstacle.worldPosition.x - worldX;
          const dyWorld = obstacle.worldPosition.y - worldY;
          const limit = radius + obstacle.radius;
          if (dxWorld * dxWorld + dyWorld * dyWorld <= limit * limit){
            results.push(obstacle);
          }
        });
      }
    }

    return results;
  }

  getSurfaceNormalAt(x, y){
    const delta = 0.5;
    const center = this.getHeightAt(x, y);
    const heightX = this.getHeightAt(x + delta, y);
    const heightY = this.getHeightAt(x, y + delta);
    const tangentX = new THREE.Vector3(delta, 0, heightX - center);
    const tangentY = new THREE.Vector3(0, delta, heightY - center);
    this._tmpNormal.copy(tangentY).cross(tangentX).normalize();
    if (this._tmpNormal.lengthSq() === 0){
      this._tmpNormal.set(0, 0, 1);
    }
    return this._tmpNormal.clone();
  }

  handleOriginShift(shift){
    if (!shift) return;
    this.originOffset.add(shift);
    this.chunkMap.forEach((chunkEntry) => {
      if (chunkEntry?.group?.position){
        chunkEntry.group.position.sub(shift);
      }
    });
  }

  applyProjectileImpact(){
    // Tile map environments do not currently support terrain deformation.
  }

  dispose(){
    this.chunkMap.forEach((chunkEntry) => this._disposeChunk(chunkEntry));
    this.chunkMap.clear();
    if (this.scene){
      this.scene.remove(this.sceneGroup);
    }
    this.sceneGroup.clear();
  }
}
