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

const F3 = 1 / 3;
const G3 = 1 / 6;

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rng() {
    t |= 0;
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function buildPermutation(seed) {
  const perm = new Uint8Array(512);
  const source = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) {
    source[i] = i;
  }
  const rng = mulberry32(seed >>> 0);
  for (let i = 255; i >= 0; i -= 1) {
    const r = Math.floor(rng() * (i + 1));
    const temp = source[i];
    source[i] = source[r];
    source[r] = temp;
  }
  for (let i = 0; i < 512; i += 1) {
    perm[i] = source[i & 255];
  }
  return perm;
}

class SimplexNoise {
  constructor(seed = 0) {
    this.perm = buildPermutation(seed);
  }

  noise3D(x, y, z) {
    const perm = this.perm;

    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);

    const t = (i + j + k) * G3;
    const X0 = i - t;
    const Y0 = j - t;
    const Z0 = k - t;
    const x0 = x - X0;
    const y0 = y - Y0;
    const z0 = z - Z0;

    let i1;
    let j1;
    let k1;
    let i2;
    let j2;
    let k2;

    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1;
        j1 = 0;
        k1 = 0;
        i2 = 1;
        j2 = 1;
        k2 = 0;
      } else if (x0 >= z0) {
        i1 = 1;
        j1 = 0;
        k1 = 0;
        i2 = 1;
        j2 = 0;
        k2 = 1;
      } else {
        i1 = 0;
        j1 = 0;
        k1 = 1;
        i2 = 1;
        j2 = 0;
        k2 = 1;
      }
    } else {
      if (y0 < z0) {
        i1 = 0;
        j1 = 0;
        k1 = 1;
        i2 = 0;
        j2 = 1;
        k2 = 1;
      } else if (x0 < z0) {
        i1 = 0;
        j1 = 1;
        k1 = 0;
        i2 = 0;
        j2 = 1;
        k2 = 1;
      } else {
        i1 = 0;
        j1 = 1;
        k1 = 0;
        i2 = 1;
        j2 = 1;
        k2 = 0;
      }
    }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;

    const gi0 = perm[ii + perm[jj + perm[kk]]] % GRAD3.length;
    const gi1 = perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] % GRAD3.length;
    const gi2 = perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] % GRAD3.length;
    const gi3 = perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] % GRAD3.length;

    let n0 = 0;
    let n1 = 0;
    let n2 = 0;
    let n3 = 0;

    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) {
      t0 *= t0;
      const g0 = GRAD3[gi0];
      n0 = t0 * t0 * (g0[0] * x0 + g0[1] * y0 + g0[2] * z0);
    }

    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) {
      t1 *= t1;
      const g1 = GRAD3[gi1];
      n1 = t1 * t1 * (g1[0] * x1 + g1[1] * y1 + g1[2] * z1);
    }

    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) {
      t2 *= t2;
      const g2 = GRAD3[gi2];
      n2 = t2 * t2 * (g2[0] * x2 + g2[1] * y2 + g2[2] * z2);
    }

    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) {
      t3 *= t3;
      const g3 = GRAD3[gi3];
      n3 = t3 * t3 * (g3[0] * x3 + g3[1] * y3 + g3[2] * z3);
    }

    return 32 * (n0 + n1 + n2 + n3);
  }

  noise2D(x, y) {
    return this.noise3D(x, y, 0);
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hash3i(x, y, z, seed) {
  let h = x | 0;
  h = Math.imul(h ^ 0x9e3779b9, 0x85ebca6b) ^ y | 0;
  h = Math.imul(h ^ 0x9e3779b9, 0x85ebca6b) ^ z | 0;
  h = Math.imul(h ^ 0x9e3779b9, 0x85ebca6b) ^ seed | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function positiveMod(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

class NoiseContext {
  constructor(seed = 0) {
    this.seed = seed >>> 0;
    this._simplexCache = new Map();
  }

  _getSimplex(salt = 0) {
    const key = salt >>> 0;
    if (!this._simplexCache.has(key)) {
      this._simplexCache.set(key, new SimplexNoise(this.seed ^ key));
    }
    return this._simplexCache.get(key);
  }

  simplex3(x, y, z, { frequency = 1, amplitude = 1, offset = [0, 0, 0], salt = 0 } = {}) {
    const simplex = this._getSimplex(salt);
    const ox = offset?.[0] ?? 0;
    const oy = offset?.[1] ?? 0;
    const oz = offset?.[2] ?? 0;
    const value = simplex.noise3D((x + ox) * frequency, (y + oy) * frequency, (z + oz) * frequency);
    return value * amplitude;
  }

  simplex2(x, y, options = {}) {
    return this.simplex3(x, y, 0, options);
  }

  fractalSimplex3(x, y, z, {
    frequency = 1,
    octaves = 3,
    lacunarity = 2,
    gain = 0.5,
    amplitude = 1,
    offset = [0, 0, 0],
    salt = 0,
  } = {}) {
    const simplex = this._getSimplex(salt);
    const ox = offset?.[0] ?? 0;
    const oy = offset?.[1] ?? 0;
    const oz = offset?.[2] ?? 0;

    let total = 0;
    let amp = 1;
    let freq = frequency;
    let maxAmp = 0;

    for (let i = 0; i < octaves; i += 1) {
      total += simplex.noise3D((x + ox + i * 19.19) * freq, (y + oy + i * 13.57) * freq, (z + oz + i * 7.71) * freq) * amp;
      maxAmp += amp;
      amp *= gain;
      freq *= lacunarity;
    }

    if (maxAmp === 0) return 0;
    return (total / maxAmp) * amplitude;
  }

  fractalSimplex2(x, y, options = {}) {
    return this.fractalSimplex3(x, y, 0, options);
  }

  chunkHash(chunkX, chunkY, chunkZ = 0, salt = 0) {
    return hash3i(chunkX | 0, chunkY | 0, chunkZ | 0, this.seed ^ (salt >>> 0));
  }

  chunkRng(chunkX, chunkY, chunkZ = 0, salt = 0) {
    return mulberry32(this.chunkHash(chunkX, chunkY, chunkZ, salt));
  }

  chunkValue(chunkX, chunkY, chunkZ = 0, salt = 0) {
    const rng = this.chunkRng(chunkX, chunkY, chunkZ, salt);
    return rng();
  }

  landmarkEveryNChunks({
    chunkX,
    chunkY,
    chunkZ = 0,
    period = 4,
    salt = 0,
    chance = 1,
    jitter = 0.5,
  }) {
    const aligned = positiveMod(chunkX, period) === 0 && positiveMod(chunkY, period) === 0;
    if (!aligned) {
      return { active: false, offset: [0, 0, 0], rng: () => 0 };
    }
    const rng = this.chunkRng(chunkX, chunkY, chunkZ, salt);
    const active = rng() < clamp(chance, 0, 1);
    const offset = [
      (rng() - 0.5) * jitter,
      (rng() - 0.5) * jitter,
      (rng() - 0.5) * jitter,
    ];
    return { active, offset, rng };
  }

  biomeMask2(x, y, { frequency = 1 / 48, octaves = 3, lacunarity = 2.2, gain = 0.55, salt = 0 } = {}) {
    const mask = this.fractalSimplex2(x, y, { frequency, octaves, lacunarity, gain, salt });
    return mask * 0.5 + 0.5;
  }
}

export function createNoiseContext(seed = 0) {
  return new NoiseContext(seed);
}

export { SimplexNoise };

