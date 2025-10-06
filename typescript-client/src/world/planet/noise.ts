import type { NoiseLayerSpec, PlanetSpec } from "./planetSpec";

const TAU = Math.PI * 2;

function hash3(x: number, y: number, z: number, seed: number): number {
  //1.- Generate a reproducible pseudo random value by mixing integer coordinates with the seed.
  const prime1 = 0x9e3779b1;
  const prime2 = 0x85ebca77;
  const prime3 = 0xc2b2ae3d;
  let h = Math.imul(Math.floor(x * 73856093) ^ Math.floor(y * 19349663) ^ Math.floor(z * 83492791), prime1);
  h = Math.imul(h ^ (h >>> 16) ^ seed, prime2);
  h ^= h >>> 13;
  h = Math.imul(h, prime3);
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

function smoothstep(t: number): number {
  //1.- Ease the interpolation parameter to avoid visible grid artifacts in value noise.
  return t * t * (3 - 2 * t);
}

function valueNoise3(x: number, y: number, z: number, seed: number): number {
  //1.- Compute lattice coordinates and fractional offsets.
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  //2.- Blend hashed corner values with trilinear interpolation.
  const xfSmooth = smoothstep(xf);
  const yfSmooth = smoothstep(yf);
  const zfSmooth = smoothstep(zf);
  const corner = (dx: number, dy: number, dz: number) =>
    hash3(xi + dx, yi + dy, zi + dz, seed);
  const c000 = corner(0, 0, 0);
  const c100 = corner(1, 0, 0);
  const c010 = corner(0, 1, 0);
  const c110 = corner(1, 1, 0);
  const c001 = corner(0, 0, 1);
  const c101 = corner(1, 0, 1);
  const c011 = corner(0, 1, 1);
  const c111 = corner(1, 1, 1);
  const x00 = c000 * (1 - xfSmooth) + c100 * xfSmooth;
  const x10 = c010 * (1 - xfSmooth) + c110 * xfSmooth;
  const x01 = c001 * (1 - xfSmooth) + c101 * xfSmooth;
  const x11 = c011 * (1 - xfSmooth) + c111 * xfSmooth;
  const y0 = x00 * (1 - yfSmooth) + x10 * yfSmooth;
  const y1 = x01 * (1 - yfSmooth) + x11 * yfSmooth;
  return y0 * (1 - zfSmooth) + y1 * zfSmooth;
}

export class DeterministicFbm {
  private readonly layers: NoiseLayerSpec[];
  private readonly seed: number;

  constructor(spec: PlanetSpec) {
    //1.- Copy only the parameters required for FBM evaluation to keep the instance self-contained.
    this.layers = [...spec.displacementLayers];
    this.seed = spec.seed;
  }

  sample(direction: { x: number; y: number; z: number }): number {
    //1.- Normalise the vector to guarantee seam-free evaluation regardless of input length.
    const length = Math.hypot(direction.x, direction.y, direction.z);
    if (length === 0) {
      return 0;
    }
    const nx = direction.x / length;
    const ny = direction.y / length;
    const nz = direction.z / length;
    let value = 0;
    let amplitudeSum = 0;
    //2.- Accumulate octave contributions evaluated on the unit vector.
    for (let i = 0; i < this.layers.length; i += 1) {
      const layer = this.layers[i];
      const scale = layer.frequency;
      const noise = valueNoise3(nx * scale, ny * scale, nz * scale, this.seed + i * 1013);
      value += (noise * 2 - 1) * layer.amplitude;
      amplitudeSum += Math.abs(layer.amplitude);
    }
    //3.- Normalise by total amplitude to keep the displacement stable across specifications.
    if (amplitudeSum === 0) {
      return 0;
    }
    return value / amplitudeSum;
  }

  gradient(direction: { x: number; y: number; z: number }, epsilon = 1e-3): {
    x: number;
    y: number;
    z: number;
  } {
    //1.- Approximate partial derivatives using central differences to feed collision normals.
    const sampleAt = (dx: number, dy: number, dz: number) =>
      this.sample({ x: direction.x + dx, y: direction.y + dy, z: direction.z + dz });
    const gx = (sampleAt(epsilon, 0, 0) - sampleAt(-epsilon, 0, 0)) / (2 * epsilon);
    const gy = (sampleAt(0, epsilon, 0) - sampleAt(0, -epsilon, 0)) / (2 * epsilon);
    const gz = (sampleAt(0, 0, epsilon) - sampleAt(0, 0, -epsilon)) / (2 * epsilon);
    return { x: gx, y: gy, z: gz };
  }
}

export function wrapAngle(angle: number): number {
  //1.- Clamp longitudes into [-pi, pi] so cubed-sphere seams remain stable.
  let wrapped = angle % TAU;
  if (wrapped <= -Math.PI) {
    wrapped += TAU;
  } else if (wrapped > Math.PI) {
    wrapped -= TAU;
  }
  return wrapped;
}
