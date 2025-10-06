import type { CubeTileKey } from "./cubedSphere";
import type { PlanetSpec } from "./planetSpec";

export interface ScatterInstance {
  //1.- Deterministically generated unique identifier per instance.
  id: string;
  //2.- Position relative to the tile in barycentric coordinates for later placement.
  localPosition: { x: number; y: number; z: number };
}

function halton(index: number, base: number): number {
  //1.- Generate low-discrepancy sequence value for blue-noise approximation.
  let result = 0;
  let f = 1;
  let i = index;
  while (i > 0) {
    f /= base;
    result += f * (i % base);
    i = Math.floor(i / base);
  }
  return result;
}

function hashTile(key: CubeTileKey, seed: number): number {
  //1.- Blend face, coordinates, lod, and external seed into a reproducible hash.
  let h = key.face * 73856093 + key.i * 19349663 + key.j * 83492791 + key.lod * 2971215073;
  h ^= seed + 0x9e3779b9 + (h << 6) + (h >> 2);
  return h >>> 0;
}

export function scatterInstances(spec: PlanetSpec, key: CubeTileKey): ScatterInstance[] {
  //1.- Determine how many instances this tile should host based on the configured budget.
  const budget = spec.scatterBudgetPerLod[Math.min(key.lod, spec.scatterBudgetPerLod.length - 1)];
  const instances: ScatterInstance[] = [];
  const tileHash = hashTile(key, spec.seed);
  for (let n = 1; n <= budget; n += 1) {
    const hx = halton(n + tileHash, 2);
    const hy = halton(n + tileHash, 3);
    const hz = halton(n + tileHash, 5);
    instances.push({
      id: `${key.face}:${key.lod}:${key.i}:${key.j}:${n}`,
      localPosition: { x: hx, y: hy, z: hz },
    });
  }
  return instances;
}
