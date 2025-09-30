// NoiseGenerator.js (merged)

// Quintic fade for smooth interpolation
function fade(t){
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t){
  return a + (b - a) * t;
}

// Classic 2D gradient set (8 dirs)
const GRADIENTS = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

// Seeded Fisher–Yates to build a 512-length permutation table
function createPermutation(seed){
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) table[i] = i;

  let state = seed >>> 0;
  for (let i = 255; i > 0; i -= 1){
    state = (state * 1664525 + 1013904223) >>> 0; // LCG
    const r = state % (i + 1);
    const tmp = table[i]; table[i] = table[r]; table[r] = tmp;
  }

  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i += 1) perm[i] = table[i & 255];
  return perm;
}

function grad(hash, x, y){
  const g = GRADIENTS[hash & 7];
  return g[0] * x + g[1] * y;
}

export class NoiseGenerator {
  /**
   * @param {number} [seed=1337]
   */
  constructor(seed = 1337){
    this.reseed(seed);
  }

  /**
   * Reseed at runtime (rebuilds permutation)
   * @param {number} seed
   */
  reseed(seed = 1337){
    this._seed = seed >>> 0;
    this.permutation = createPermutation(this._seed);
  }

  /**
   * 2D Perlin noise in [0, 1]
   * @param {number} x
   * @param {number} y
   */
  perlin2(x, y){
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;

    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const p = this.permutation;

    const bl = p[p[X] + Y];
    const br = p[p[X + 1] + Y];
    const tl = p[p[X] + Y + 1];
    const tr = p[p[X + 1] + Y + 1];

    const u = fade(xf);
    const v = fade(yf);

    const x1 = lerp(grad(bl, xf,     yf    ), grad(br, xf - 1, yf    ), u);
    const x2 = lerp(grad(tl, xf,     yf - 1), grad(tr, xf - 1, yf - 1), u);

    return (lerp(x1, x2, v) + 1) * 0.5; // map [-1,1] -> [0,1]
  }

  /**
   * Fractal Brownian Motion (fBm) over Perlin
   * Returns [0,1]
   * @param {number} x
   * @param {number} y
   * @param {Object} [opts]
   * @param {number} [opts.octaves=4]
   * @param {number} [opts.persistence=0.5]  // amplitude multiplier per octave
   * @param {number} [opts.lacunarity=2.0]   // frequency multiplier per octave
   * @param {number} [opts.scale=1.0]        // base frequency scale
   */
  fractal2(x, y, { octaves = 4, persistence = 0.5, lacunarity = 2, scale = 1 } = {}){
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let maxAmp = 0;

    for (let o = 0; o < octaves; o += 1){
      sum += this.perlin2(x * freq * scale, y * freq * scale) * amp;
      maxAmp += amp;
      amp *= persistence;
      freq *= lacunarity;
    }
    return maxAmp ? (sum / maxAmp) : 0;
  }
}
