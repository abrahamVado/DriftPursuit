export interface RockyTextureOptions {
  size?: number
  seed?: number
}

export interface RockyTextureBundle {
  size: number
  data: Uint8Array
}

const DEFAULT_SIZE = 256

function smoothStep(value: number): number {
  //1.- Ease interpolation edges so the layered noise transitions softly between grid samples.
  return value * value * (3 - 2 * value)
}

function interpolate(a: number, b: number, t: number): number {
  //2.- Blend two values using the smoothed interpolation factor for coherent noise synthesis.
  return a + (b - a) * t
}

function pseudoRandom(x: number, y: number, seed: number): number {
  //3.- Produce a deterministic pseudo-random value in the range [0, 1) using a hashed sine pattern.
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 19.19) * 43758.5453
  return s - Math.floor(s)
}

function clamp(value: number, min: number, max: number): number {
  //4.- Bound a value between the provided limits without pulling in Three.js helpers that are undefined during tests.
  return Math.min(max, Math.max(min, value))
}

function valueNoise(x: number, y: number, seed: number): number {
  //5.- Sample value noise by interpolating pseudo-random corner values across a grid cell.
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = x0 + 1
  const y1 = y0 + 1
  const tx = smoothStep(x - x0)
  const ty = smoothStep(y - y0)
  const n00 = pseudoRandom(x0, y0, seed)
  const n10 = pseudoRandom(x1, y0, seed)
  const n01 = pseudoRandom(x0, y1, seed)
  const n11 = pseudoRandom(x1, y1, seed)
  const ix0 = interpolate(n00, n10, tx)
  const ix1 = interpolate(n01, n11, tx)
  return interpolate(ix0, ix1, ty)
}

function fractalBrownianMotion(x: number, y: number, seed: number, octaves: number): number {
  //6.- Layer multiple octaves of value noise to create rich surface detail reminiscent of cratered stone.
  let amplitude = 1
  let frequency = 1
  let sum = 0
  let weight = 0
  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise(x * frequency, y * frequency, seed + i * 37.17) * amplitude
    weight += amplitude
    amplitude *= 0.5
    frequency *= 2
  }
  return weight > 0 ? sum / weight : 0
}

export function generateRockyPlanetTexture(options: RockyTextureOptions = {}): RockyTextureBundle {
  //7.- Resolve configuration values with safe defaults so the generator can run without explicit input.
  const size = Math.max(16, options.size ?? DEFAULT_SIZE)
  const seed = options.seed ?? 42
  const data = new Uint8Array(size * size * 4)
  let offset = 0

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      //8.- Normalise coordinates into [0, 1] to keep the procedural pattern resolution independent.
      const u = x / size
      const v = y / size
      const base = fractalBrownianMotion(u * 8, v * 8, seed, 4)
      const craters = fractalBrownianMotion(u * 24 + 17.3, v * 24 + 9.1, seed + 91.7, 3)
      const ridge = fractalBrownianMotion(u * 16 - 5.4, v * 16 + 12.6, seed + 13.5, 2)
      //9.- Sculpt a crater mask by emphasising deviations from the midpoint and blending in ridge detail.
      const craterMask = Math.pow(Math.abs(craters - 0.5) * 2, 1.6)
      const ridgeMask = ridge * 0.45 + 0.35
      //10.- Assemble the final intensity and bias the palette toward moonlit basalt tones.
      const intensity = clamp(base * 0.55 + craterMask * 0.35 + ridgeMask * 0.25, 0, 1)
      const r = 48 + intensity * 92
      const g = 58 + intensity * 84
      const b = 72 + intensity * 68
      data[offset] = r
      data[offset + 1] = g
      data[offset + 2] = b
      data[offset + 3] = 255
      offset += 4
    }
  }

  //11.- Return the packed texture data so the runtime can upload it using the active Three.js context.
  return { size, data }
}
