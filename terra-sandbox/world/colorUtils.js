const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function lerpColorStops(colors, t, THREE){
  const stops = Array.isArray(colors[0]) ? colors : colors.map((c, i, arr) => [arr.length === 1 ? 0 : i / (arr.length - 1), c]);
  const tt = clamp(t, 0, 1);
  for (let i = 0; i < stops.length - 1; i += 1){
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (tt >= t0 && tt <= t1){
      const span = Math.max(1e-6, t1 - t0);
      const f = (tt - t0) / span;
      const col0 = new THREE.Color(c0);
      const col1 = new THREE.Color(c1);
      return col0.lerp(col1, f);
    }
  }
  return new THREE.Color(stops[stops.length - 1][1]);
}

export function createColorState({ colors = {}, THREE }){
  const ramps = colors.ramps ?? null;
  const gradient = {
    low: new THREE.Color(colors.low ?? '#2f5b2f'),
    mid: new THREE.Color(colors.mid ?? '#4e7741'),
    high: new THREE.Color(colors.high ?? '#c2c5c7'),
    lowThreshold: colors.lowThreshold ?? 30,
    highThreshold: colors.highThreshold ?? 140,
    highCap: colors.highCap ?? 300,
  };
  return { ramps, gradient };
}

export function sampleClimate({ worldX, worldY, generatorConfig, noise }){
  const climate = generatorConfig?.climate ?? {};
  const t = climate.temperature ?? null;
  const m = climate.moisture ?? null;
  const temp = t ? (noise.perlin2(worldX * (t.frequency ?? 0) + (t.offset?.[0] ?? 0), worldY * (t.frequency ?? 0) + (t.offset?.[1] ?? 0)) * 2 - 1) : 0;
  const moist = m ? (noise.perlin2(worldX * (m.frequency ?? 0) + (m.offset?.[0] ?? 0), worldY * (m.frequency ?? 0) + (m.offset?.[1] ?? 0)) * 2 - 1) : 0;
  return { temp, moist };
}

export function pickBiome({ height, climate, generatorConfig, world }){
  const rules = generatorConfig?.biomes?.rules;
  if (Array.isArray(rules) && rules.length){
    for (const rule of rules){
      const when = rule.when ?? {};
      if (when.default) return rule.name;
      if (when.heightBelow != null && !(height < when.heightBelow)) continue;
      if (when.heightAbove != null && !(height > when.heightAbove)) continue;
      if (when.heightBetween && !(height >= when.heightBetween[0] && height <= when.heightBetween[1])) continue;
      if (when.temperatureBelow != null && !(climate.temp < when.temperatureBelow)) continue;
      if (when.temperatureAbove != null && !(climate.temp > when.temperatureAbove)) continue;
      if (when.moistureBelow != null && !(climate.moist < when.moistureBelow)) continue;
      if (when.moistureAbove != null && !(climate.moist > when.moistureAbove)) continue;
      return rule.name;
    }
  }
  if (height < world.waterLevel) return 'ocean';
  if (height < world.waterLevel + world.beachBand) return 'beach';
  if (height > world.snowline) return 'snow';
  return 'grass';
}

export function sampleColorLegacy({ gradient, height }){
  if (height < gradient.lowThreshold) return gradient.low.clone();
  if (height < gradient.highThreshold){
    const t = clamp((height - gradient.lowThreshold) / Math.max(1, gradient.highThreshold - gradient.lowThreshold), 0, 1);
    return gradient.low.clone().lerp(gradient.mid, t);
  }
  const t = clamp((height - gradient.highThreshold) / Math.max(1, gradient.highCap - gradient.highThreshold), 0, 1);
  return gradient.mid.clone().lerp(gradient.high, t);
}

export function sampleBiomeColor({ worldX, worldY, height, ramps, gradient, world, generatorConfig, noise, THREE }){
  if (ramps){
    const climate = sampleClimate({ worldX, worldY, generatorConfig, noise });
    const biome = pickBiome({ height, climate, generatorConfig, world });
    const ramp = ramps[biome];
    if (ramp){
      let t = 0.5;
      if (biome === 'ocean'){
        const wl = world.waterLevel;
        t = clamp((height - (wl - 40)) / 40, 0, 1);
      } else if (biome === 'beach'){
        t = clamp((height - world.waterLevel) / Math.max(1, world.beachBand), 0, 1);
      } else if (biome === 'snow'){
        t = clamp((height - world.snowline) / 100, 0, 1);
      } else {
        const lo = gradient.lowThreshold;
        const hi = gradient.highCap;
        t = clamp((height - lo) / Math.max(1, hi - lo), 0, 1);
      }
      return lerpColorStops(ramp, t, THREE);
    }
  }
  return sampleColorLegacy({ gradient, height });
}
