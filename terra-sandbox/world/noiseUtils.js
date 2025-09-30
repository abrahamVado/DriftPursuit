const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;

function hash2i(x, y){
  let h = x | 0;
  h = Math.imul(h ^ 0x9e3779b9, 0x85ebca6b) ^ y | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function createRng(seed){
  let state = seed >>> 0;
  return function rng(){
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFromCell(cx, cy, seed){
  return createRng(hash2i(hash2i(cx, cy), seed));
}

export function createCraterConfig(overrides = {}){
  return Object.assign({
    enabled: true,
    spacing: 1200,
    chance: 0.22,
    radius: [120, 340],
    depth: [20, 120],
    rimSharpness: 1.8,
    jitter: 0.42,
  }, overrides);
}

export function createLakeConfig(overrides = {}){
  return Object.assign({
    enabled: overrides.enabled ?? true,
    perChunk: 1,
    noiseFrequency: 0.0009,
    threshold: 0.58,
    radius: [18, 80],
    levelOffset: -2,
  }, overrides);
}

export function sampleHeightBase({ worldX, worldY, generatorConfig, noise }){
  const cfg = generatorConfig ?? {};
  const { noise: noiseCfg, plateau } = cfg;

  let sx = worldX;
  let sy = worldY;
  const warp = noiseCfg?.warp;
  if (warp){
    const wf = warp.frequency ?? 0;
    const wo = warp.offset ?? [0, 0];
    const wx = noise.perlin2(worldX * wf + (wo[0] ?? 0), worldY * wf + (wo[1] ?? 0));
    const wy = noise.perlin2((worldX + 1000) * wf + (wo[0] ?? 0), (worldY - 1000) * wf + (wo[1] ?? 0));
    const wa = warp.amplitude ?? 0;
    sx += wx * wa;
    sy += wy * wa;
  }

  const hills = noiseCfg?.hills ?? {};
  const hn = noise.fractal2(
    sx * (hills.frequency ?? 0) + (hills.offset?.[0] ?? 0),
    sy * (hills.frequency ?? 0) + (hills.offset?.[1] ?? 0),
    { octaves: hills.octaves ?? 4, persistence: hills.persistence ?? 0.55, lacunarity: hills.lacunarity ?? 2.1 },
  );
  let height = hn * (hills.amplitude ?? 55);

  const m = noiseCfg?.mountains ?? {};
  const mn = noise.fractal2(
    sx * (m.frequency ?? 0) + (m.offset?.[0] ?? 0),
    sy * (m.frequency ?? 0) + (m.offset?.[1] ?? 0),
    { octaves: m.octaves ?? 5, persistence: m.persistence ?? 0.52, lacunarity: m.lacunarity ?? 2.05 },
  );
  if ((m.amplitude ?? 0) !== 0){
    const exp = m.exponent ?? 1;
    const strength = Math.pow(Math.max(0, mn), exp);
    height += strength * (m.amplitude ?? 0);
  }

  const r = noiseCfg?.ridges ?? {};
  if ((r.amplitude ?? 0) !== 0){
    const rb = noise.perlin2(sx * (r.frequency ?? 0) + (r.offset?.[0] ?? 0), sy * (r.frequency ?? 0) + (r.offset?.[1] ?? 0));
    const rexp = r.exponent ?? 1;
    const rstr = Math.pow(Math.abs(rb * 2 - 1), rexp);
    height += rstr * (r.amplitude ?? 0);
  }

  const d = noiseCfg?.detail;
  if (d && (d.amplitude ?? 0) !== 0){
    const dn = noise.fractal2(
      sx * (d.frequency ?? 0),
      sy * (d.frequency ?? 0),
      { octaves: d.octaves ?? 3, persistence: d.persistence ?? 0.45, lacunarity: d.lacunarity ?? 2.4 },
    );
    height += dn * (d.amplitude ?? 0);
  }

  const p = plateau ?? {};
  const distance = Math.sqrt(sx * sx + sy * sy);
  const flatRadius = p.flatRadius ?? 160;
  const blendRadius = p.blendRadius ?? 340;
  if (distance < blendRadius){
    const t = clamp((distance - flatRadius) / Math.max(1, blendRadius - flatRadius), 0, 1);
    height = lerp(p.height ?? 8, height, t);
  }

  return height;
}

export function craterContribution({ worldX, worldY, craterConfig, seed }){
  const c = craterConfig;
  if (!c?.enabled) return 0;
  const spacing = Math.max(200, c.spacing | 0);
  const cx = Math.floor(worldX / spacing);
  const cy = Math.floor(worldY / spacing);
  let contrib = 0;
  for (let ox = -1; ox <= 1; ox += 1){
    for (let oy = -1; oy <= 1; oy += 1){
      const ix = cx + ox;
      const iy = cy + oy;
      const cellRng = rngFromCell(ix, iy, seed ^ 0x6b33);
      if (cellRng() > (c.chance ?? 0.22)) continue;

      const jitter = c.jitter ?? 0.42;
      const centerX = (ix + 0.5 + (cellRng() - 0.5) * jitter) * spacing;
      const centerY = (iy + 0.5 + (cellRng() - 0.5) * jitter) * spacing;

      const rmin = c.radius?.[0] ?? 120;
      const rmax = c.radius?.[1] ?? 340;
      const radius = rmin + cellRng() * (rmax - rmin);

      const dmin = c.depth?.[0] ?? 20;
      const dmax = c.depth?.[1] ?? 120;
      const depth = dmin + cellRng() * (dmax - dmin);

      const dx = worldX - centerX;
      const dy = worldY - centerY;
      const rdist = Math.hypot(dx, dy);
      if (rdist > radius) continue;

      const t = 1 - rdist / Math.max(1, radius);
      const rimSharp = c.rimSharpness ?? 1.8;
      contrib -= Math.pow(t, rimSharp) * depth;
    }
  }
  return contrib;
}

export function sampleHeight({ worldX, worldY, generatorConfig, noise, craterConfig, seed, volcano }){
  let height = sampleHeightBase({ worldX, worldY, generatorConfig, noise });
  height += craterContribution({ worldX, worldY, craterConfig, seed });

  const v = volcano;
  if (v?.enabled && Array.isArray(v.center) && v.center.length >= 2){
    const cx = v.center[0] ?? 0;
    const cy = v.center[1] ?? 0;
    const dx = worldX - cx;
    const dy = worldY - cy;
    const dist = Math.hypot(dx, dy);
    const baseRadius = v.baseRadius ?? 1100;
    if (dist <= baseRadius){
      const rimSharp = v.rimSharpness ?? 2.2;
      const t = clamp(1 - dist / Math.max(1, baseRadius), 0, 1);
      let add = Math.pow(t, rimSharp) * (v.height ?? 820);
      const n = v.noise ?? {};
      if ((n.amplitude ?? 0) !== 0){
        const f = n.frequency ?? 0.003;
        const jag = noise.perlin2(worldX * f, worldY * f) * 2 - 1;
        add += jag * (n.amplitude ?? 60) * t;
      }
      const craterRadius = v.craterRadius ?? 220;
      if (dist < craterRadius){
        const craterT = 1 - dist / Math.max(1, craterRadius);
        const depth = v.craterDepth ?? 180;
        const carve = craterT * craterT * depth;
        add -= carve;
        add += (v.floorLift ?? 40) * (1 - craterT);
      }
      height += add;
    }
  }
  return height;
}

export function slopeMagnitude({ worldX, worldY, sampleHeight: sampleHeightFn }){
  const delta = 2;
  const center = sampleHeightFn(worldX, worldY);
  const dx = sampleHeightFn(worldX + delta, worldY) - center;
  const dy = sampleHeightFn(worldX, worldY + delta) - center;
  return Math.sqrt(dx * dx + dy * dy) / delta;
}
