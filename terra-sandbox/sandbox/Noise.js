function createPermutation(seed){
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1){
    table[i] = i;
  }
  let state = seed >>> 0;
  for (let i = 255; i > 0; i -= 1){
    state = (state * 1664525 + 1013904223) >>> 0;
    const r = state % (i + 1);
    const tmp = table[i];
    table[i] = table[r];
    table[r] = tmp;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i += 1){
    perm[i] = table[i & 255];
  }
  return perm;
}

function fade(t){
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t){
  return a + (b - a) * t;
}

function grad(hash, x, y){
  switch (hash & 3){
    case 0: return x + y;
    case 1: return -x + y;
    case 2: return x - y;
    case 3: return -x - y;
    default: return 0;
  }
}

export class NoiseGenerator {
  constructor(seed = 0){
    this.permutation = createPermutation(seed);
  }

  perlin2(x, y){
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;

    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const topRight = this.permutation[this.permutation[X + 1] + Y + 1];
    const topLeft = this.permutation[this.permutation[X] + Y + 1];
    const bottomRight = this.permutation[this.permutation[X + 1] + Y];
    const bottomLeft = this.permutation[this.permutation[X] + Y];

    const u = fade(xf);
    const v = fade(yf);

    const x1 = lerp(grad(bottomLeft, xf, yf), grad(bottomRight, xf - 1, yf), u);
    const x2 = lerp(grad(topLeft, xf, yf - 1), grad(topRight, xf - 1, yf - 1), u);
    const value = lerp(x1, x2, v);
    return (value + 1) / 2;
  }

  fractal2(x, y, { octaves = 4, persistence = 0.5, lacunarity = 2 } = {}){
    let amplitude = 1;
    let frequency = 1;
    let total = 0;
    let maxAmplitude = 0;
    for (let i = 0; i < octaves; i += 1){
      total += this.perlin2(x * frequency, y * frequency) * amplitude;
      maxAmplitude += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    if (maxAmplitude === 0) return 0;
    return total / maxAmplitude;
  }
}
