import { THREE } from './threeLoader.js';

const GRAD3 = [
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1],
];

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

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function hash3(x, y, z, seed) {
  let h = Math.imul(x, 374761393);
  h = (h + Math.imul(y, 668265263)) | 0;
  h = (h + Math.imul(z, 987643213)) | 0;
  h = (h + Math.imul(seed, 362437)) | 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177);
  return h ^ (h >>> 16);
}

function grad3(hashValue, x, y, z) {
  const g = GRAD3[hashValue % GRAD3.length];
  return g[0] * x + g[1] * y + g[2] * z;
}

function perlin3(x, y, z, seed = 0) {
  const xi0 = Math.floor(x);
  const yi0 = Math.floor(y);
  const zi0 = Math.floor(z);
  const xf0 = x - xi0;
  const yf0 = y - yi0;
  const zf0 = z - zi0;
  const xi1 = xi0 + 1;
  const yi1 = yi0 + 1;
  const zi1 = zi0 + 1;

  const g000 = grad3(hash3(xi0, yi0, zi0, seed), xf0, yf0, zf0);
  const g100 = grad3(hash3(xi1, yi0, zi0, seed), xf0 - 1, yf0, zf0);
  const g010 = grad3(hash3(xi0, yi1, zi0, seed), xf0, yf0 - 1, zf0);
  const g110 = grad3(hash3(xi1, yi1, zi0, seed), xf0 - 1, yf0 - 1, zf0);
  const g001 = grad3(hash3(xi0, yi0, zi1, seed), xf0, yf0, zf0 - 1);
  const g101 = grad3(hash3(xi1, yi0, zi1, seed), xf0 - 1, yf0, zf0 - 1);
  const g011 = grad3(hash3(xi0, yi1, zi1, seed), xf0, yf0 - 1, zf0 - 1);
  const g111 = grad3(hash3(xi1, yi1, zi1, seed), xf0 - 1, yf0 - 1, zf0 - 1);

  const u = fade(xf0);
  const v = fade(yf0);
  const w = fade(zf0);

  const x00 = lerp(g000, g100, u);
  const x10 = lerp(g010, g110, u);
  const x01 = lerp(g001, g101, u);
  const x11 = lerp(g011, g111, u);

  const y0 = lerp(x00, x10, v);
  const y1 = lerp(x01, x11, v);

  return lerp(y0, y1, w);
}

function fractalNoise3(x, y, z, {
  seed = 0,
  octaves = 4,
  lacunarity = 2,
  gain = 0.5,
  frequency = 0.02,
} = {}) {
  let amp = 1;
  let freq = frequency;
  let total = 0;
  let maxAmp = 0;

  for (let i = 0; i < octaves; i += 1) {
    total += perlin3(x * freq, y * freq, z * freq, seed + i * 97) * amp;
    maxAmp += amp;
    amp *= gain;
    freq *= lacunarity;
  }

  return maxAmp === 0 ? 0 : total / maxAmp;
}

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
  }

  configure({ coordKey, origin, densityFn, chunkSize, resolution, threshold }) {
    this.coordKey = coordKey;
    this.chunkSize = chunkSize;
    this.resolution = resolution;
    this.threshold = threshold;
    this.origin.copy(origin);
    this.mesh.position.copy(origin);
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
        color: new THREE.Color('#7d3f26'),
        roughness: 0.95,
        metalness: 0.08,
        flatShading: true,
      });
    this.material.side = THREE.FrontSide;

    this.activeChunks = new Map();
    this.chunkPool = [];
    this.dustField = null;

    this._densityFn = this._densityAt.bind(this);
    this._desiredOffsets = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: -1, z: 0 },
      { x: 1, y: 1, z: 0 },
    ];
  }

  _key(coord) {
    return `${coord.x}:${coord.y}:${coord.z}`;
  }

  _originForCoord(coord) {
    return new THREE.Vector3(
      coord.x * this.chunkSize + this.horizontalOffset,
      coord.y * this.chunkSize + this.horizontalOffset,
      coord.z * this.chunkSize + this.verticalOffset,
    );
  }

  _positionToCoord(value, offset = this.horizontalOffset) {
    return Math.floor((value - offset) / this.chunkSize);
  }

  _surfaceElevation(x, y) {
    const base = fractalNoise3(x, y, 0, {
      seed: this.seed + 211,
      frequency: 0.02,
      octaves: 4,
      gain: 0.55,
    });
    const ridged = fractalNoise3(x + 400, y - 400, 0, {
      seed: this.seed + 977,
      frequency: 0.04,
      octaves: 3,
      gain: 0.6,
    });
    return 6 + base * 8 + ridged * 4;
  }

  _densityAt(x, y, z) {
    const surface = this._surfaceElevation(x, y);
    const vertical = (surface - z) / 6;

    const caverns = fractalNoise3(x, y, z, {
      seed: this.seed + 101,
      frequency: 0.085,
      octaves: 4,
      gain: 0.55,
    });
    const pockets = fractalNoise3(x + 200, y - 200, z * 0.7, {
      seed: this.seed + 409,
      frequency: 0.12,
      octaves: 3,
      gain: 0.58,
    });
    const shafts = fractalNoise3(x * 0.45, y * 0.45, z, {
      seed: this.seed + 901,
      frequency: 0.18,
      octaves: 2,
      gain: 0.6,
    });
    const tunnelBand = Math.sin((x + this.seed * 0.13) * 0.06) + Math.sin((y - this.seed * 0.07) * 0.06);
    const radial = Math.cos(Math.sqrt(x * x + y * y) * 0.04 + this.seed * 0.01) * 0.12;

    return vertical + caverns * 0.75 + pockets * 0.45 - Math.abs(tunnelBand) * 0.35 + shafts * 0.28 + radial - 0.2;
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

  updateChunks(position) {
    if (!position) return;
    const center = {
      x: this._positionToCoord(position.x),
      y: this._positionToCoord(position.y),
      z: 0,
    };

    const desired = this._desiredOffsets.map((offset) => ({
      x: center.x + offset.x,
      y: center.y + offset.y,
      z: center.z + offset.z,
    }));

    const neededKeys = new Set(desired.map((coord) => this._key(coord)));

    for (const [key, chunk] of this.activeChunks.entries()) {
      if (!neededKeys.has(key)) {
        this.activeChunks.delete(key);
        this.group.remove(chunk.mesh);
        chunk.mesh.visible = false;
        this.chunkPool.push(chunk);
      }
    }

    for (const coord of desired) {
      const key = this._key(coord);
      let chunk = this.activeChunks.get(key);
      if (!chunk) {
        chunk = this._acquireChunk();
        const origin = this._originForCoord(coord);
        chunk.configure({
          coordKey: key,
          origin,
          densityFn: this._densityFn,
          chunkSize: this.chunkSize,
          resolution: this.resolution,
          threshold: this.threshold,
        });
        this.group.add(chunk.mesh);
        this.activeChunks.set(key, chunk);
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
    for (const chunk of this.activeChunks.values()) {
      chunk.configure({
        coordKey: chunk.coordKey,
        origin: chunk.mesh.position.clone(),
        densityFn: this._densityFn,
        chunkSize: this.chunkSize,
        resolution: this.resolution,
        threshold: this.threshold,
      });
      if (!this.group.children.includes(chunk.mesh)) {
        this.group.add(chunk.mesh);
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
    if (this.material && this.material.dispose) {
      this.material.dispose();
    }
  }
}
