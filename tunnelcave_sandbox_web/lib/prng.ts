export type HashInput = number | readonly number[];

export function hashMix(seed: HashInput): number {
  const arr = Array.isArray(seed) ? seed : [seed];
  let h = 1779033703 ^ arr.length;
  for (let i = 0; i < arr.length; i += 1) {
    let k = Math.imul(arr[i] | 0, 3432918353);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 461845907);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = Math.imul(h, 5) + 3864292196;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

export function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(rand: () => number, min: number, max: number): number {
  return min + (max - min) * rand();
}

export function randUnitVector(rand: () => number): [number, number, number] {
  const z = rand() * 2 - 1;
  const theta = rand() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [r * Math.cos(theta), r * Math.sin(theta), z];
}
