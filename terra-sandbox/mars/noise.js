const GRADIENTS = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const TAU = Math.PI * 2;

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function hash(x, y, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 362437);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177);
  return h ^ (h >>> 16);
}

function grad(hashValue, x, y) {
  const g = GRADIENTS[hashValue & 7];
  return g[0] * x + g[1] * y;
}

export function perlin2(x, y, seed = 0) {
  const xi0 = Math.floor(x);
  const yi0 = Math.floor(y);
  const xf0 = x - xi0;
  const yf0 = y - yi0;
  const xi1 = xi0 + 1;
  const yi1 = yi0 + 1;

  const g00 = grad(hash(xi0, yi0, seed), xf0, yf0);
  const g10 = grad(hash(xi1, yi0, seed), xf0 - 1, yf0);
  const g01 = grad(hash(xi0, yi1, seed), xf0, yf0 - 1);
  const g11 = grad(hash(xi1, yi1, seed), xf0 - 1, yf0 - 1);

  const u = fade(xf0);
  const v = fade(yf0);

  const x1 = lerp(g00, g10, u);
  const x2 = lerp(g01, g11, u);
  return lerp(x1, x2, v);
}

export function fractalNoise2D(x, y, {
  seed = 0,
  octaves = 4,
  lacunarity = 2,
  gain = 0.5,
  frequency = 0.0025,
} = {}) {
  let amp = 1;
  let freq = frequency;
  let total = 0;
  let maxAmp = 0;

  for (let i = 0; i < octaves; i += 1) {
    total += perlin2(x * freq, y * freq, seed + i * 97) * amp;
    maxAmp += amp;
    amp *= gain;
    freq *= lacunarity;
  }

  return maxAmp === 0 ? 0 : total / maxAmp;
}

export function ridgedNoise2D(x, y, options = {}) {
  const value = fractalNoise2D(x, y, options);
  const ridge = 1 - Math.abs(value);
  return ridge * ridge;
}

export function warpCoordinate(x, y, { seed = 0, amplitude = 32, frequency = 0.004 } = {}) {
  const angle = fractalNoise2D(x, y, { seed: seed + 421, frequency, octaves: 3, gain: 0.65 }) * TAU;
  const strength = fractalNoise2D(x + 1000, y - 1000, { seed: seed + 997, frequency: frequency * 0.5, octaves: 2 }) * 0.5 + 0.5;
  const offset = amplitude * strength;
  return {
    x: x + Math.cos(angle) * offset,
    y: y + Math.sin(angle) * offset,
  };
}
