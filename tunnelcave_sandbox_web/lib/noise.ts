import { hashMix, mulberry32 } from "./prng";
import type { Vec3 } from "./vector";
import { vec3 } from "./vector";

function latticeValue(seed: number, x: number, y: number, z: number): number {
  const h = hashMix([seed, Math.floor(x), Math.floor(y), Math.floor(z)]);
  const rand = mulberry32(h);
  return rand() * 2 - 1;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function trilinearInterpolation(seed: number, p: Vec3): number {
  const [x, y, z] = p;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);
  const tz = smoothstep(z - z0);

  let accum = 0;
  for (let dx = 0; dx <= 1; dx += 1) {
    for (let dy = 0; dy <= 1; dy += 1) {
      for (let dz = 0; dz <= 1; dz += 1) {
        const weight =
          (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
        accum += weight * latticeValue(seed, x0 + dx, y0 + dy, z0 + dz);
      }
    }
  }
  return accum;
}

export function fbmNoise(
  seed: number,
  p: Vec3,
  octaves: number,
  frequency: number,
  gain: number,
  lacunarity = 2
): number {
  let amp = 1;
  let freq = frequency;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    const sample = trilinearInterpolation(seed + i * 1013, [
      p[0] * freq,
      p[1] * freq,
      p[2] * freq
    ]);
    sum += sample * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm === 0 ? 0 : sum / norm;
}

export function vectorPotential(seed: number, p: Vec3): Vec3 {
  return vec3(
    fbmNoise(seed + 17, p, 3, 0.7, 0.6),
    fbmNoise(seed + 53, p, 3, 0.7, 0.6),
    fbmNoise(seed + 97, p, 3, 0.7, 0.6)
  );
}

export function curlNoise(seed: number, p: Vec3, eps = 0.25): Vec3 {
  const px = [p[0] + eps, p[1], p[2]] as Vec3;
  const mx = [p[0] - eps, p[1], p[2]] as Vec3;
  const py = [p[0], p[1] + eps, p[2]] as Vec3;
  const my = [p[0], p[1] - eps, p[2]] as Vec3;
  const pz = [p[0], p[1], p[2] + eps] as Vec3;
  const mz = [p[0], p[1], p[2] - eps] as Vec3;

  const a = vectorPotential(seed, px);
  const b = vectorPotential(seed, mx);
  const c = vectorPotential(seed, py);
  const d = vectorPotential(seed, my);
  const e = vectorPotential(seed, pz);
  const f = vectorPotential(seed, mz);

  const dx = [(a[1] - b[1]) / (2 * eps), (a[2] - b[2]) / (2 * eps)];
  const dy = [(c[0] - d[0]) / (2 * eps), (c[2] - d[2]) / (2 * eps)];
  const dz = [(e[0] - f[0]) / (2 * eps), (e[1] - f[1]) / (2 * eps)];

  return vec3(dy[1] - dz[1], dz[0] - dx[1], dx[0] - dy[0]);
}
