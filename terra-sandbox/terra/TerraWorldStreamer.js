import { BaseWorldStreamer } from '../world/BaseWorldStreamer.js';
import { requireTHREE } from '../shared/threeSetup.js';

const THREE = requireTHREE();

function chunkKey(x, y){
  return `${x}:${y}`;
}

function ensureVector3(input){
  if (!input) return new THREE.Vector3();
  if (input.isVector3) return input.clone();
  if (Array.isArray(input)){
    const [x = 0, y = 0, z = 0] = input;
    return new THREE.Vector3(x, y, z);
  }
  const { x = 0, y = 0, z = 0 } = input;
  return new THREE.Vector3(x, y, z);
}

function cloneWorldVector(vector){
  return new THREE.Vector3(vector.x, vector.y, vector.z);
}

const DEFAULT_CRATER_DEPTH = 0.18;
const DEFAULT_CRATER_RADIUS = 0.55; // meters, scaled up slightly so it is visible on coarse terrain grids

export class TerraWorldStreamer extends BaseWorldStreamer {
  constructor(options = {}){
    const { generator = null, procedural = null, ...rest } = options ?? {};
    super({ ...rest, generator, procedural, THREE });
    this.chunkDeformations = new Map();
    this.craterMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a3a3a,
      roughness: 0.95,
      metalness: 0.04,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    this.sharedMaterials.add?.(this.craterMaterial);
    this.disposables.push(this.craterMaterial);
    this.damagedObstacleCache = new Map();
    this._tmpNormal = new THREE.Vector3(0, 0, 1);
  }

  _spawnChunk(chunkX, chunkY){
    const chunk = super._spawnChunk(chunkX, chunkY);
    if (!chunk) return chunk;
    chunk.key = chunkKey(chunkX, chunkY);
    this._captureChunkBaseHeights(chunk);
    this._rehydrateChunkDeformations(chunk);
    return chunk;
  }

  _disposeChunk(chunk){
    if (chunk?.obstacles){
      for (const obstacle of chunk.obstacles){
        const mesh = obstacle?.mesh;
        if (mesh){
          this.damagedObstacleCache.delete(mesh.uuid);
        }
      }
    }
    super._disposeChunk(chunk);
  }

  dispose(){
    super.dispose();
    this.chunkDeformations.clear();
    this.damagedObstacleCache.clear();
  }

  handleOriginShift(shift){
    super.handleOriginShift(shift);
  }

  getSurfaceNormalAt(x, y){
    const delta = 0.5;
    const heightCenter = this.getHeightAt(x, y);
    const heightX = this.getHeightAt(x + delta, y);
    const heightY = this.getHeightAt(x, y + delta);
    const tangentX = new THREE.Vector3(delta, 0, heightX - heightCenter);
    const tangentY = new THREE.Vector3(0, delta, heightY - heightCenter);
    this._tmpNormal.copy(tangentY).cross(tangentX).normalize();
    if (this._tmpNormal.lengthSq() === 0){
      this._tmpNormal.set(0, 0, 1);
    }
    return this._tmpNormal.clone();
  }

  applyProjectileImpact({ position, normal, radius = DEFAULT_CRATER_RADIUS, depth = DEFAULT_CRATER_DEPTH, obstacle } = {}){
    if (!position) return;
    const localPosition = ensureVector3(position);
    const impactNormal = normal ? ensureVector3(normal).normalize() : this.getSurfaceNormalAt(localPosition.x, localPosition.y);
    const globalPosition = localPosition.clone().add(this.originOffset);
    const craterRecord = {
      worldPosition: cloneWorldVector(globalPosition),
      radius,
      depth,
      normal: cloneWorldVector(impactNormal),
    };

    const minChunkX = Math.floor((globalPosition.x - radius) / this.chunkSize);
    const maxChunkX = Math.floor((globalPosition.x + radius) / this.chunkSize);
    const minChunkY = Math.floor((globalPosition.y - radius) / this.chunkSize);
    const maxChunkY = Math.floor((globalPosition.y + radius) / this.chunkSize);

    for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1){
      for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY += 1){
        const key = chunkKey(chunkX, chunkY);
        const entry = this._getChunkDeformationEntry(key);
        const hasExisting = entry.craters.some((existing) => {
          const dx = existing.worldPosition.x - craterRecord.worldPosition.x;
          const dy = existing.worldPosition.y - craterRecord.worldPosition.y;
          return dx * dx + dy * dy < Math.max(0.5, craterRecord.radius * craterRecord.radius * 0.25);
        });
        if (!hasExisting){
          entry.craters.push(this._cloneCraterRecord(craterRecord));
        }
        entry.version += 1;
        this.chunkDeformations.set(key, entry);
        const chunk = this.chunkMap.get(key);
        if (chunk){
          this._captureChunkBaseHeights(chunk);
          this._applyChunkDeformations(chunk, entry);
        }
      }
    }

    if (obstacle){
      this._recordObstacleDamage(obstacle, globalPosition);
    }
  }

  _captureChunkBaseHeights(chunk){
    if (!chunk?.terrain?.geometry) return;
    if (chunk.terrain.baseHeights) return;
    const positions = chunk.terrain.geometry.attributes.position;
    const baseHeights = new Float32Array(positions.count);
    for (let i = 0; i < positions.count; i += 1){
      baseHeights[i] = positions.getZ(i);
    }
    chunk.terrain.baseHeights = baseHeights;
  }

  _rehydrateChunkDeformations(chunk){
    if (!chunk?.key) return;
    const entry = this.chunkDeformations.get(chunk.key);
    if (!entry) return;
    this._applyChunkDeformations(chunk, entry);
  }

  _getChunkDeformationEntry(key){
    const existing = this.chunkDeformations.get(key);
    if (existing) return existing;
    const entry = { craters: [], damagedProps: [], version: 0 };
    this.chunkDeformations.set(key, entry);
    return entry;
  }

  _cloneCraterRecord(record){
    return {
      worldPosition: cloneWorldVector(record.worldPosition),
      radius: record.radius,
      depth: record.depth,
      normal: cloneWorldVector(record.normal ?? new THREE.Vector3(0, 0, 1)),
    };
  }

  _applyChunkDeformations(chunk, entry){
    if (!chunk?.terrain?.geometry) return;
    const { geometry } = chunk.terrain;
    const positions = geometry.attributes.position;
    const baseHeights = chunk.terrain.baseHeights;
    if (!positions || !baseHeights) return;

    const chunkOriginX = chunk.coords.x * this.chunkSize;
    const chunkOriginY = chunk.coords.y * this.chunkSize;

    for (let i = 0; i < positions.count; i += 1){
      const baseHeight = baseHeights[i];
      let height = baseHeight;
      const localX = positions.getX(i);
      const localY = positions.getY(i);
      const worldX = chunkOriginX + localX;
      const worldY = chunkOriginY + localY;
      for (const crater of entry.craters){
        const dx = worldX - crater.worldPosition.x;
        const dy = worldY - crater.worldPosition.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > crater.radius) continue;
        const falloff = 1 - distance / crater.radius;
        height -= crater.depth * falloff * falloff;
      }
      positions.setZ(i, height);
    }

    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.attributes.normal.needsUpdate = true;
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();

    this._refreshChunkDecals(chunk, entry);
    this._applyStoredObstacleDamage(chunk, entry);
  }

  _refreshChunkDecals(chunk, entry){
    if (!chunk?.group) return;
    if (!chunk.craterDecals) chunk.craterDecals = [];

    for (const decal of chunk.craterDecals){
      chunk.group.remove(decal);
      decal.geometry?.dispose?.();
    }
    chunk.craterDecals.length = 0;

    const chunkOriginX = chunk.coords.x * this.chunkSize;
    const chunkOriginY = chunk.coords.y * this.chunkSize;

    for (const crater of entry.craters){
      const decalGeometry = new THREE.CircleGeometry(Math.max(0.02, crater.radius), 16);
      const decal = new THREE.Mesh(decalGeometry, this.craterMaterial);
      const localX = crater.worldPosition.x - chunkOriginX;
      const localY = crater.worldPosition.y - chunkOriginY;
      decal.position.set(localX, localY, this._sampleHeight(crater.worldPosition.x, crater.worldPosition.y) + 0.02);
      const normal = crater.normal ?? new THREE.Vector3(0, 0, 1);
      const quaternion = new THREE.Quaternion();
      quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
      decal.quaternion.copy(quaternion);
      chunk.group.add(decal);
      chunk.craterDecals.push(decal);
    }
  }

  _recordObstacleDamage(obstacle, globalImpactPosition){
    if (!obstacle) return;
    const mesh = obstacle.mesh ?? obstacle;
    if (!mesh) return;
    const worldPosition = obstacle.worldPosition ? cloneWorldVector(obstacle.worldPosition) : mesh.getWorldPosition(new THREE.Vector3());
    const chunkX = Math.floor(worldPosition.x / this.chunkSize);
    const chunkY = Math.floor(worldPosition.y / this.chunkSize);
    const key = chunkKey(chunkX, chunkY);
    const entry = this._getChunkDeformationEntry(key);
    const radius = obstacle.radius ?? mesh.geometry?.boundingSphere?.radius ?? 3;
    const impact = globalImpactPosition ? cloneWorldVector(globalImpactPosition) : worldPosition.clone();
    const duplicate = entry.damagedProps.find((existing) => {
      const dx = existing.worldPosition.x - worldPosition.x;
      const dy = existing.worldPosition.y - worldPosition.y;
      const distanceSq = dx * dx + dy * dy;
      return distanceSq < 1.0;
    });
    if (!duplicate){
      entry.damagedProps.push({
        worldPosition,
        radius,
        type: obstacle.type ?? 'generic',
        impact,
      });
    }
    entry.version += 1;
    const chunk = this.chunkMap.get(key);
    if (chunk){
      this._applyStoredObstacleDamage(chunk, entry);
    }
  }

  _applyStoredObstacleDamage(chunk, entry){
    if (!chunk?.obstacles) return;
    if (!entry?.damagedProps?.length) return;

    for (const record of entry.damagedProps){
      let closest = null;
      let closestDistance = Infinity;
      for (const obstacle of chunk.obstacles){
        const dx = obstacle.worldPosition.x - record.worldPosition.x;
        const dy = obstacle.worldPosition.y - record.worldPosition.y;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq < closestDistance){
          closestDistance = distanceSq;
          closest = obstacle;
        }
      }
      if (closest){
        const mesh = closest.mesh;
        const id = mesh.uuid;
        if (this.damagedObstacleCache.has(id)) continue;
        this.damagedObstacleCache.set(id, true);
        this._markObstacleDamaged(mesh, record);
      }
    }
  }

  _markObstacleDamaged(mesh, record){
    if (!mesh) return;
    if (mesh.userData?.damaged) return;
    const damagedMaterial = mesh.material?.clone?.();
    if (damagedMaterial){
      if (damagedMaterial.color){
        damagedMaterial.color.multiplyScalar(0.6);
      }
      if (typeof damagedMaterial.roughness === 'number'){
        damagedMaterial.roughness = Math.min(1, damagedMaterial.roughness + 0.18);
      }
      if (typeof damagedMaterial.metalness === 'number'){
        damagedMaterial.metalness = Math.max(0, damagedMaterial.metalness - 0.08);
      }
      mesh.material = damagedMaterial;
    }
    mesh.scale.multiplyScalar(0.97);
    mesh.userData.damaged = true;
    mesh.userData.impactRecord = record;
  }
}
