export interface ValueNoise2D {
  sample: (x: number, z: number) => number
}

export interface FractalOptions {
  frequency: number
  amplitude: number
  octaves: number
  gain: number
  lacunarity: number
}

function hash2(seed: number, x: number, z: number): number {
  //1.- Combine the coordinates and seed into a single integer through large prime multipliers for decorrelation.
  let value = Math.imul(Math.floor(x), 374761393) + Math.imul(Math.floor(z), 668265263)
  value = (value ^ (value >> 13)) >>> 0
  value = (value * (seed | 0x9e3779b1)) >>> 0
  //2.- Scramble the bits using xorshift-style steps so the distribution approaches white noise.
  value ^= value << 17
  value ^= value >> 9
  value ^= value << 4
  return (value >>> 0) / 4294967295
}

export function createValueNoise2D(seed: number): ValueNoise2D {
  const smooth = (t: number) => t * t * (3 - 2 * t)

  return {
    sample(x: number, z: number) {
      //1.- Identify the surrounding lattice cell and fetch hashed values for the four corners.
      const x0 = Math.floor(x)
      const z0 = Math.floor(z)
      const xf = x - x0
      const zf = z - z0
      const v00 = hash2(seed, x0, z0)
      const v10 = hash2(seed, x0 + 1, z0)
      const v01 = hash2(seed, x0, z0 + 1)
      const v11 = hash2(seed, x0 + 1, z0 + 1)
      //2.- Smoothly interpolate first along X and then along Z to obtain a coherent value between 0 and 1.
      const i1 = v00 + (v10 - v00) * smooth(xf)
      const i2 = v01 + (v11 - v01) * smooth(xf)
      return i1 + (i2 - i1) * smooth(zf)
    },
  }
}

export function fractalNoise(
  noise: ValueNoise2D,
  x: number,
  z: number,
  options: FractalOptions,
): number {
  //1.- Sum multiple octaves of value noise where each octave increases frequency and decreases amplitude.
  let total = 0
  let amplitude = options.amplitude
  let frequency = options.frequency
  let max = 0
  for (let octave = 0; octave < options.octaves; octave += 1) {
    total += noise.sample(x * frequency, z * frequency) * amplitude
    max += amplitude
    amplitude *= options.gain
    frequency *= options.lacunarity
  }
  //2.- Normalise by the accumulated amplitude so the result remains bounded between 0 and 1.
  return max === 0 ? 0 : total / max
}

export function ridgedMultifractal(
  noise: ValueNoise2D,
  x: number,
  z: number,
  options: FractalOptions,
): number {
  //1.- Flip the base noise around 0.5 and square it so high ridges dominate over flat plains.
  let total = 0
  let amplitude = options.amplitude
  let frequency = options.frequency
  let weight = 1
  for (let octave = 0; octave < options.octaves; octave += 1) {
    const sample = noise.sample(x * frequency, z * frequency)
    const ridge = (1 - Math.abs(sample * 2 - 1)) ** 2
    total += ridge * amplitude * weight
    weight = ridge
    amplitude *= options.gain
    frequency *= options.lacunarity
  }
  //2.- Clamp into the 0..1 range so downstream blending behaves predictably.
  return Math.max(0, Math.min(1, total))
}

export function domainWarp(
  noise: ValueNoise2D,
  x: number,
  z: number,
  strength: number,
  frequency: number,
): { x: number; z: number } {
  //1.- Sample two decorrelated axes of noise to generate a displacement vector for the input domain.
  const offsetX = noise.sample(x * frequency, z * frequency) * 2 - 1
  const offsetZ = noise.sample((x + 37.2) * frequency, (z - 19.1) * frequency) * 2 - 1
  //2.- Scale by the requested strength to produce warped coordinates that add organic variation.
  return { x: x + offsetX * strength, z: z + offsetZ * strength }
}
