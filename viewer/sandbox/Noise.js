const PERMUTATION_TABLE = new Uint8Array(512);
const BASE_PERM = new Uint8Array(256);

function buildPermutation(seed){
  let value = seed >>> 0;
  for (let i = 0; i < 256; i += 1){
    value = (value * 1664525 + 1013904223) >>> 0;
    BASE_PERM[i] = value & 0xff;
  }
  for (let i = 0; i < 512; i += 1){
    PERMUTATION_TABLE[i] = BASE_PERM[i & 255];
  }
}

const GRADIENTS = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

function fade(t){
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t){
  return a + (b - a) * t;
}

function grad(hash, x, y){
  const g = GRADIENTS[hash & 7];
  return g[0] * x + g[1] * y;
}

export class NoiseGenerator {
  constructor(seed = 1337){
    buildPermutation(seed);
  }

  perlin2(x, y){
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const topRight = PERMUTATION_TABLE[PERMUTATION_TABLE[xi + 1] + yi + 1];
    const topLeft = PERMUTATION_TABLE[PERMUTATION_TABLE[xi] + yi + 1];
    const bottomRight = PERMUTATION_TABLE[PERMUTATION_TABLE[xi + 1] + yi];
    const bottomLeft = PERMUTATION_TABLE[PERMUTATION_TABLE[xi] + yi];

    const u = fade(xf);
    const v = fade(yf);

    const x1 = lerp(grad(bottomLeft, xf, yf), grad(bottomRight, xf - 1, yf), u);
    const x2 = lerp(grad(topLeft, xf, yf - 1), grad(topRight, xf - 1, yf - 1), u);
    return (lerp(x1, x2, v) + 1) / 2;
  }

  fractal2(x, y, { octaves = 4, persistence = 0.5, lacunarity = 2, scale = 1 } = {}){
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let maxValue = 0;
    for (let o = 0; o < octaves; o += 1){
      sum += this.perlin2(x * frequency * scale, y * frequency * scale) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    if (maxValue === 0) return 0;
    return sum / maxValue;
  }
}
