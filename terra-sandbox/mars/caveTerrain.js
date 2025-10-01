import { THREE } from './threeLoader.js';
import { createNoiseContext } from './noiseContext.js';

const TMP_VECTOR = new THREE.Vector3();
const GRADIENT_EPSILON = 0.75;

const FACE_DEFINITIONS = [
  {
    offset: [1, 0, 0],
    normal: [1, 0, 0],
    corners: [
      [1, 0, 0],
      [1, 0, 1],
      [1, 1, 1],
      [1, 1, 0],
    ],
  },
  {
    offset: [-1, 0, 0],
    normal: [-1, 0, 0],
    corners: [
      [0, 0, 0],
      [0, 1, 0],
      [0, 1, 1],
      [0, 0, 1],
    ],
  },
  {
    offset: [0, 1, 0],
    normal: [0, 1, 0],
    corners: [
      [0, 1, 0],
      [1, 1, 0],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    offset: [0, -1, 0],
    normal: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 0, 0],
    ],
  },
  {
    offset: [0, 0, 1],
    normal: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
      [1, 0, 1],
    ],
  },
  {
    offset: [0, 0, -1],
    normal: [0, 0, -1],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
];

function generateChunkGeometry({ origin, chunkSize, resolution, threshold, densityFn }) {
  const step = chunkSize / resolution;
  const totalCells = resolution * resolution * resolution;
  const solid = new Array(totalCells);
  const vertices = [];
  const normals = [];

  const idx = (x, y, z) => x + resolution * (y + resolution * z);

  for (let z = 0; z < resolution; z += 1) {
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        const wx = origin.x + (x + 0.5) * step;
        const wy = origin.y + (y + 0.5) * step;
        const wz = origin.z + (z + 0.5) * step;
        solid[idx(x, y, z)] = densityFn(wx, wy, wz) > threshold;
      }
    }
  }

  for (let z = 0; z < resolution; z += 1) {
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        if (!solid[idx(x, y, z)]) continue;
        const baseX = x * step;
        const baseY = y * step;
        const baseZ = z * step;

        for (const face of FACE_DEFINITIONS) {
          const nx = x + face.offset[0];
          const ny = y + face.offset[1];
          const nz = z + face.offset[2];
          let neighborSolid = false;
          if (nx >= 0 && nx < resolution && ny >= 0 && ny < resolution && nz >= 0 && nz < resolution) {
            neighborSolid = solid[idx(nx, ny, nz)];
          }
          if (neighborSolid) continue;

          const [nxr, nyr, nzr] = face.normal;
          const normal = [nxr, nyr, nzr];
          const corners = face.corners.map(([cx, cy, cz]) => [
            baseX + cx * step,
            baseY + cy * step,
            baseZ + cz * step,
          ]);
          const [c0, c1, c2, c3] = corners;

          vertices.push(
            c0[0], c0[1], c0[2],
            c1[0], c1[1], c1[2],
            c2[0], c2[1], c2[2],
            c0[0], c0[1], c0[2],
            c2[0], c2[1], c2[2],
            c3[0], c3[1], c3[2],
          );

          for (let i = 0; i < 6; i += 1) {
            normals.push(normal[0], normal[1], normal[2]);
          }
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  if (vertices.length === 0) {
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }

  const positionAttr = new THREE.Float32BufferAttribute(vertices, 3);
  const normalAttr = new THREE.Float32BufferAttribute(normals, 3);
  geometry.setAttribute('position', positionAttr);
  geometry.setAttribute('normal', normalAttr);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

class MarsCaveChunk {
  constructor({ chunkSize, resolution, threshold, material }) {
    this.chunkSize = chunkSize;
    this.resolution = resolution;
    this.threshold = threshold;
    this.material = material;
    this.origin = new THREE.Vector3();
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    this.coordKey = null;
    this.metadata = null;
  }

  configure({ coordKey, origin, densityFn, chunkSize, resolution, threshold, metadata }) {
    this.coordKey = coordKey;
    this.chunkSize = chunkSize;
    this.resolution = resolution;
    this.threshold = threshold;
    this.origin.copy(origin);
    this.mesh.position.copy(origin);
    this.metadata = metadata ?? null;
    this.rebuild(densityFn);
  }

  rebuild(densityFn) {
    if (this.mesh.geometry) {
      this.mesh.geometry.dispose();
    }
    const geometry = generateChunkGeometry({
      origin: this.origin,
      chunkSize: this.chunkSize,
      resolution: this.resolution,
      threshold: this.threshold,
      densityFn,
    });
    this.mesh.geometry = geometry;
    this.mesh.visible = geometry.getAttribute('position')?.count > 0;
  }

  dispose() {
    if (this.mesh.geometry) {
      this.mesh.geometry.dispose();
    }
  }
}

export class MarsCaveTerrainManager {
  constructor({
    seed = 0,
    chunkSize = 16,
    resolution = 16,
    threshold = 0,
    material,
    horizontalRadius = 1,
    verticalRadius = 0,
    mode = 'complex',
  } = {}) {
    this.seed = seed >>> 0;
    this.chunkSize = chunkSize;
    this.resolution = resolution;
    this.threshold = threshold;
    this.horizontalOffset = -chunkSize / 2;
    this.verticalOffset = -chunkSize / 2;
    this.group = new THREE.Group();
    this.group.name = 'marsCaveTerrain';
    this.material =
      material ||
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#8e4f34'),
        roughness: 0.88,
        metalness: 0.1,
        flatShading: false,
        emissive: new THREE.Color('#1a0c12'),
        emissiveIntensity: 0.32,
      });
    this.material.side = THREE.DoubleSide;

    this.activeChunks = new Map();
    this.chunkPool = [];
    this.dustField = null;
    this.noise = createNoiseContext(this.seed);
    this.chunkMetadata = new Map();
    this.lifecycleHandlers = {
      onChunkActivated: null,
      onChunkDeactivated: null,
    };

    this.horizontalRadius = Math.max(0, Math.floor(horizontalRadius));
    this.verticalRadius = Math.max(0, Math.floor(verticalRadius));
    this.mode = mode;

    this._densityFn = this._densityAt.bind(this);
    this._desiredOffsets = this._buildDesiredOffsets();
  }

  _buildDesiredOffsets({ horizontal = this.horizontalRadius, vertical = this.verticalRadius } = {}) {
    const offsets = [];
    for (let z = -vertical; z <= vertical; z += 1) {
      for (let x = -horizontal; x <= horizontal; x += 1) {
        for (let y = -horizontal; y <= horizontal; y += 1) {
          offsets.push({ x, y, z });
        }
      }
    }
    offsets.sort((a, b) => {
      const da = Math.hypot(a.x, a.y) + Math.abs(a.z) * 1.6;
      const db = Math.hypot(b.x, b.y) + Math.abs(b.z) * 1.6;
      return da - db;
    });
    return offsets;
  }

  _key(coord) {
    return `${coord.x}:${coord.y}:${coord.z}`;
  }

  _parseKey(key) {
    const [x, y, z] = key.split(':').map((value) => parseInt(value, 10) || 0);
    return { x, y, z };
  }

  parseCoord(key) {
    return this._parseKey(key);
  }

  _originForCoord(coord) {
    return new THREE.Vector3(
      coord.x * this.chunkSize + this.horizontalOffset,
      coord.y * this.chunkSize + this.horizontalOffset,
      coord.z * this.chunkSize + this.verticalOffset,
    );
  }

  getChunkCenter(coord) {
    return new THREE.Vector3(
      coord.x * this.chunkSize + this.horizontalOffset + this.chunkSize * 0.5,
      coord.y * this.chunkSize + this.horizontalOffset + this.chunkSize * 0.5,
      coord.z * this.chunkSize + this.verticalOffset + this.chunkSize * 0.5,
    );
  }

  _positionToCoord(value, offset = this.horizontalOffset) {
    return Math.floor((value - offset) / this.chunkSize);
  }

  getChunkMetadata(coord) {
    return this.chunkMetadata.get(this._key(coord));
  }

  _surfaceElevation(x, y) {
    const base = this.noise.fractalSimplex2(x, y, {
      frequency: 0.02,
      octaves: 3,
      gain: 0.58,
      lacunarity: 1.95,
      salt: 0x211,
    });
    const ridged = this.noise.fractalSimplex2(x + 400, y - 400, {
      frequency: 0.038,
      octaves: 3,
      gain: 0.6,
      lacunarity: 2.1,
      salt: 0x977,
    });
    return 6 + base * 8 + ridged * 4;
  }

  _biomeMask(x, y) {
    return this.noise.biomeMask2(x, y, {
      frequency: 0.018,
      octaves: 3,
      gain: 0.6,
      lacunarity: 2.25,
      salt: 0x351,
    });
  }

  _biomeDensityBias(maskValue) {
    if (maskValue < 0.33) return -0.12;
    if (maskValue < 0.66) return 0.04;
    return 0.12;
  }

  _hazardField(x, y, z) {
    const swirls = this.noise.fractalSimplex3(x, y, z, {
      frequency: 0.11,
      octaves: 2,
      gain: 0.52,
      lacunarity: 2.4,
      salt: 0x611,
    });
    const pulses = this.noise.simplex3(x, y, z, {
      frequency: 0.035,
      amplitude: 0.18,
      offset: [120, -260, 40],
      salt: 0x7b9,
    });
    return Math.abs(swirls) * 0.18 + pulses;
  }

  _resourceNodesForChunk(coord, biome) {
    const period = biome === 'lumenite' ? 3 : 5;
    const chance = biome === 'lumenite' ? 0.68 : 0.36;
    const landmark = this.noise.landmarkEveryNChunks({
      chunkX: coord.x,
      chunkY: coord.y,
      chunkZ: coord.z,
      salt: biome === 'lumenite' ? 0x9a1 : 0x5f3,
      period,
      chance,
      jitter: 0.8,
    });
    if (!landmark.active) return [];
    return [
      {
        type: biome === 'lumenite' ? 'crystalCluster' : 'mineralPocket',
        offset: landmark.offset,
      },
    ];
  }

  _describeChunk(coord) {
    const cx = coord.x * this.chunkSize + this.chunkSize * 0.5;
    const cy = coord.y * this.chunkSize + this.chunkSize * 0.5;
    const mask = this._biomeMask(cx, cy);
    let biome = 'ember';
    if (mask >= 0.66) {
      biome = 'lumenite';
    } else if (mask >= 0.33) {
      biome = 'siltstone';
    }
    const hazards = this._hazardField(cx, cy, 0);
    const resources = this._resourceNodesForChunk(coord, biome);
    return { biome, mask, hazards, resources };
  }

  _densityAt(x, y, z) {
    const surface = this._surfaceElevation(x, y);
    const vertical = (surface - z) / 8.5;

    if (this.mode === 'simplified') {
      const broad = this.noise.fractalSimplex3(x * 0.6, y * 0.6, z * 0.45, {
        frequency: 0.045,
        octaves: 3,
        gain: 0.62,
        lacunarity: 2,
        salt: 0x301,
      });
      const tunnels = this.noise.fractalSimplex3(x * 0.85 + 120, y * 0.85 - 120, z * 0.9, {
        frequency: 0.11,
        octaves: 2,
        gain: 0.58,
        lacunarity: 2.2,
        salt: 0x515,
      });
      const ripples = this.noise.simplex3(x * 0.35 - 80, y * 0.35 + 80, z * 0.65, {
        frequency: 0.07,
        amplitude: 0.45,
        salt: 0x41f,
      });
      const biomeBias = this._biomeDensityBias(this._biomeMask(x, y)) * 0.55;
      return (
        vertical +
        broad * 0.82 -
        Math.abs(tunnels) * 0.46 +
        ripples * 0.26 +
        biomeBias -
        0.12
      );
    }

    const cavernLayer = this.noise.fractalSimplex3(x, y, z, {
      frequency: 0.072,
      octaves: 3,
      gain: 0.6,
      lacunarity: 2.1,
      salt: 0x101,
    });
    const tunnelLayer = this.noise.fractalSimplex3(x + 200, y - 200, z * 0.8, {
      frequency: 0.14,
      octaves: 2,
      gain: 0.64,
      lacunarity: 2.25,
      salt: 0x409,
    });
    const pocketLayer = this.noise.fractalSimplex3(x * 0.45, y * 0.45, z, {
      frequency: 0.19,
      octaves: 3,
      gain: 0.6,
      lacunarity: 1.9,
      salt: 0x901,
    });
    const tunnelBand = Math.sin((x + this.seed * 0.13) * 0.058) + Math.sin((y - this.seed * 0.07) * 0.058);
    const radial = Math.cos(Math.sqrt(x * x + y * y) * 0.04 + this.seed * 0.01) * 0.18;
    const biomeBias = this._biomeDensityBias(this._biomeMask(x, y)) * 0.85;
    const hazards = this._hazardField(x, y, z) * -0.42;

    return (
      vertical +
      cavernLayer * 0.88 +
      pocketLayer * 0.32 +
      tunnelBand * 0.18 +
      radial +
      biomeBias -
      Math.abs(tunnelLayer) * 0.48 +
      hazards -
      0.18
    );
  }

  sampleHeight(x, y) {
    const surface = this._surfaceElevation(x, y);
    const top = surface + 12;
    const bottom = surface - 24;
    const step = 0.5;

    let previousValue = this._densityAt(x, y, top);
    let previousZ = top;
    for (let z = top - step; z >= bottom; z -= step) {
      const value = this._densityAt(x, y, z);
      if (previousValue < 0 && value >= 0) {
        const t = previousValue === value ? 0 : (0 - previousValue) / (value - previousValue);
        return previousZ + (z - previousZ) * t;
      }
      previousValue = value;
      previousZ = z;
    }
    return surface;
  }

  setLifecycleHandlers({ onChunkActivated = null, onChunkDeactivated = null } = {}) {
    this.lifecycleHandlers = {
      onChunkActivated,
      onChunkDeactivated,
    };
  }

  _verticalIsoSurface({ x, y, z, direction = -1, range = 48, step = 0.5 }) {
    const iso = this.threshold ?? 0;
    const steps = Math.max(1, Math.ceil(range / Math.max(0.05, Math.abs(step))));
    let previousZ = z;
    let previousValue = this._densityAt(x, y, z) - iso;
    for (let i = 1; i <= steps; i += 1) {
      const currentZ = z + direction * step * i;
      const currentValue = this._densityAt(x, y, currentZ) - iso;
      if ((previousValue < 0 && currentValue >= 0) || (previousValue > 0 && currentValue <= 0)) {
        const denom = currentValue - previousValue;
        const t = Math.abs(denom) < 1e-5 ? 0 : (0 - previousValue) / denom;
        return previousZ + (currentZ - previousZ) * THREE.MathUtils.clamp(t, 0, 1);
      }
      previousZ = currentZ;
      previousValue = currentValue;
    }
    return null;
  }

  queryVolume(position, { radius = 6, verticalRange = 64, step = 0.5 } = {}) {
    if (!position) return null;
    const x = position.x ?? position[0];
    const y = position.y ?? position[1];
    const z = position.z ?? position[2];
    if (![x, y, z].every(Number.isFinite)) {
      return null;
    }

    const iso = this.threshold ?? 0;
    const centerValue = this._densityAt(x, y, z) - iso;

    const epsilon = Math.max(0.35, GRADIENT_EPSILON, radius * 0.12);
    const sample = (sx, sy, sz) => this._densityAt(sx, sy, sz) - iso;

    const dx = sample(x + epsilon, y, z) - sample(x - epsilon, y, z);
    const dy = sample(x, y + epsilon, z) - sample(x, y - epsilon, z);
    const dz = sample(x, y, z + epsilon) - sample(x, y, z - epsilon);
    TMP_VECTOR.set(dx, dy, dz).multiplyScalar(0.5 / epsilon);
    const gradLength = TMP_VECTOR.length();

    let outwardNormal = null;
    if (gradLength > 1e-4) {
      outwardNormal = TMP_VECTOR.clone().multiplyScalar(-1 / gradLength);
    }

    const inside = centerValue >= 0;
    const distanceToSurface = gradLength > 1e-4 ? Math.abs(centerValue) / gradLength : Math.abs(centerValue);

    const floor = this._verticalIsoSurface({ x, y, z, direction: -1, range: verticalRange, step }) ?? null;
    const ceiling = this._verticalIsoSurface({ x, y, z, direction: 1, range: verticalRange, step }) ?? null;
    const floorDistance = Number.isFinite(floor) ? Math.max(0, z - floor) : null;
    const ceilingDistance = Number.isFinite(ceiling) ? Math.max(0, ceiling - z) : null;

    return {
      floor,
      ceiling,
      floorDistance,
      ceilingDistance,
      inside,
      distanceToSurface,
      normal: outwardNormal,
    };
  }

  updateChunks(position) {
    if (!position) return;
    const center = {
      x: this._positionToCoord(position.x),
      y: this._positionToCoord(position.y),
      z: this._positionToCoord(position.z, this.verticalOffset),
    };

    const desired = this._desiredOffsets.map((offset) => ({
      x: center.x + offset.x,
      y: center.y + offset.y,
      z: center.z + offset.z,
    }));

    const neededKeys = new Set(desired.map((coord) => this._key(coord)));

    const { onChunkDeactivated } = this.lifecycleHandlers;
    for (const [key, chunk] of this.activeChunks.entries()) {
      if (!neededKeys.has(key)) {
        if (typeof onChunkDeactivated === 'function') {
          const coord = this._parseKey(key);
          const metadata = this.chunkMetadata.get(key) ?? null;
          onChunkDeactivated({ key, coord, chunk, metadata });
        }
        this.activeChunks.delete(key);
        this.group.remove(chunk.mesh);
        chunk.mesh.visible = false;
        this.chunkPool.push(chunk);
        this.chunkMetadata.delete(key);
      }
    }

    const { onChunkActivated } = this.lifecycleHandlers;
    for (const coord of desired) {
      const key = this._key(coord);
      let chunk = this.activeChunks.get(key);
      if (!chunk) {
        chunk = this._acquireChunk();
        const origin = this._originForCoord(coord);
        const metadata = this._describeChunk(coord);
        chunk.configure({
          coordKey: key,
          origin,
          densityFn: this._densityFn,
          chunkSize: this.chunkSize,
          resolution: this.resolution,
          threshold: this.threshold,
          metadata,
        });
        this.group.add(chunk.mesh);
        this.activeChunks.set(key, chunk);
        this.chunkMetadata.set(key, metadata);
        if (typeof onChunkActivated === 'function') {
          onChunkActivated({ key, coord, chunk, metadata });
        }
      } else if (!this.chunkMetadata.has(key)) {
        const metadata = chunk.metadata ?? this._describeChunk(coord);
        this.chunkMetadata.set(key, metadata);
        if (typeof onChunkActivated === 'function') {
          onChunkActivated({ key, coord, chunk, metadata });
        }
      }
    }
  }

  _acquireChunk() {
    if (this.chunkPool.length > 0) {
      return this.chunkPool.pop();
    }
    return new MarsCaveChunk({
      chunkSize: this.chunkSize,
      resolution: this.resolution,
      threshold: this.threshold,
      material: this.material,
    });
  }

  regenerate(seed) {
    this.seed = seed >>> 0;
    this.noise = createNoiseContext(this.seed);
    this.chunkMetadata.clear();
    const { onChunkActivated, onChunkDeactivated } = this.lifecycleHandlers;
    for (const chunk of this.activeChunks.values()) {
      const coord = this._parseKey(chunk.coordKey);
      if (typeof onChunkDeactivated === 'function') {
        const metadata = chunk.metadata ?? null;
        onChunkDeactivated({ key: chunk.coordKey, coord, chunk, metadata });
      }
      const metadata = this._describeChunk(coord);
      chunk.configure({
        coordKey: chunk.coordKey,
        origin: chunk.mesh.position.clone(),
        densityFn: this._densityFn,
        chunkSize: this.chunkSize,
        resolution: this.resolution,
        threshold: this.threshold,
        metadata,
      });
      if (!this.group.children.includes(chunk.mesh)) {
        this.group.add(chunk.mesh);
      }
      this.chunkMetadata.set(chunk.coordKey, metadata);
      if (typeof onChunkActivated === 'function') {
        onChunkActivated({ key: chunk.coordKey, coord, chunk, metadata });
      }
    }
  }

  dispose() {
    for (const chunk of this.activeChunks.values()) {
      this.group.remove(chunk.mesh);
      chunk.dispose();
    }
    this.activeChunks.clear();
    for (const chunk of this.chunkPool) {
      chunk.dispose();
    }
    this.chunkPool.length = 0;
    this.group.clear();
    this.chunkMetadata.clear();
    if (this.material && this.material.dispose) {
      this.material.dispose();
    }
  }
}
