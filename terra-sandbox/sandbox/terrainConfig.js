// terrainConfig.js

// ────────────────────────────────────────────────────────────────────────────
// Deep-ish merge helper (handles nested objects & arrays). Backward compatible
// with your old usage of `merge(base, extra)` for presets.
// ────────────────────────────────────────────────────────────────────────────
export const merge = (base, extra = {}) => {
  if (extra == null || typeof extra !== 'object') return structuredClone(base);
  if (Array.isArray(base) && Array.isArray(extra)) return structuredClone(extra);
  if (Array.isArray(base)) return structuredClone(base);
  const out = structuredClone(base);
  for (const k of Object.keys(extra)) {
    const a = out[k], b = extra[k];
    if (b && typeof b === 'object' && !Array.isArray(b) && a && typeof a === 'object' && !Array.isArray(a)) {
      out[k] = merge(a, b);
    } else {
      out[k] = structuredClone(b);
    }
  }
  return out;
};

/**
 * SUPER CONFIG – TerraGen v2++
 * - Backward compatible keys (noise, plateau, features, colors, mountains, rocks, towns, rivers)
 * - Adds: domain warp, climate masks, lakes, dunes, mega volcanoes, impact crater,
 *         biomes with ramps, perf switches, materials, and themed space-y presets.
 */
export const DEFAULT_GENERATOR_CONFIG = {
  // ───────────────────────────── GLOBAL ─────────────────────────────
  meta: {
    version: 3,
    name: 'TerraGen v2++ – balanced',
    description: 'Balanced procedural world with biomes, lakes, rivers, dunes, mega volcano, and crater.',
  },
  seed: 133742069,
  scale: 1.0,
  world: {
    bounds: { minX: -200000, maxX: 200000, minY: -200000, maxY: 200000 }, // set to null for infinite
    tileSize: 900,
    visibleRadius: 5,
    waterLevel: 18,
    snowline: 220,
    beachBand: 10,
  },

  // ───────────────────────────── NOISE STACK ────────────────────────
  noise: {
    hills:     { frequency: 0.0012, offset: [0, 0],   octaves: 4, persistence: 0.55, lacunarity: 2.1, amplitude: 55,  exponent: 1   },
    mountains: { frequency: 0.00042, offset: [40,-60],octaves: 5, persistence: 0.52, lacunarity: 2.05, amplitude: 360, exponent: 3.15},
    ridges:    { frequency: 0.0024, offset: [0, 0],   amplitude: 22, exponent: 1.65 },
    detail:    { frequency: 0.0065,                    octaves: 3, persistence: 0.45, lacunarity: 2.4, amplitude: 8,   exponent: 1   },
    warp:      { frequency: 0.00085, amplitude: 120, octaves: 2, persistence: 0.6, lacunarity: 2.2, offset: [3000, -2000] },
  },

  // (future hook; your streamer can ignore unless you add a pass)
  erosion: { enabled: true, iterations: 40, talusAngle: 0.58, carryCapacity: 0.9, evaporation: 0.12, sedimentDissolve: 0.6, carveBias: 0.7 },

  // ───────────────────────── CLIMATE / MASKS ────────────────────────
  climate: {
    temperature: { frequency: 0.00016, offset: [1800, -2600] }, // -1 cold → +1 hot
    moisture:    { frequency: 0.00022, offset: [-900,  3400] }, // -1 dry  → +1 wet
  },
  cliffs: { slopeThreshold: 0.78, cliffBoost: 34, maskFrequency: 0.0015 },

  // ───────────────────────── PLAY AREA / PLATEAU ────────────────────
  plateau: { flatRadius: 180, blendRadius: 360, height: 10 },

  // ─────────────────────── MEGA VOLCANO(S) & CRATER ─────────────────
  // Single volcano (back-compat)
  volcano: {
    enabled: true,
    center: [0, 0],
    baseRadius: 1100,
    height: 820,
    craterRadius: 220,
    craterDepth: 180,
    rimSharpness: 2.2,
    floorLift: 40,
    noise: { frequency: 0.0028, amplitude: 65 },
    lava:  { color: '#ff5a1f', emissive: '#ff8a00', emissiveIntensity: 1.6, levelOffset: -12 }
  },

  // Multiple volcanoes (optional)
  volcanoes: [
    {
      enabled: true,
      center: [0, 0],
      baseRadius: 1100,
      height: 820,
      craterRadius: 220,
      craterDepth: 180,
      rimSharpness: 2.2,
      floorLift: 40,
      noise: { frequency: 0.0028, amplitude: 65 },
      lava:  { color: '#ff5a1f', emissive: '#ff8a00', emissiveIntensity: 1.6, levelOffset: -12 }
    },
    {
      enabled: true,
      center: [1600, -900],
      baseRadius: 620,
      height: 520,
      craterRadius: 140,
      craterDepth: 120,
      rimSharpness: 2.0,
      floorLift: 20,
      noise: { frequency: 0.0032, amplitude: 42 },
      lava:  { color: '#ff6a2f', emissive: '#ff9a20', emissiveIntensity: 1.2, levelOffset: -10 }
    }
  ],

  // One big impact crater (height carve + raised rim)
  crater: {
    enabled: true,
    center: [2500, -1200],
    baseRadius: 700,
    depth: 220,
    rimHeight: 90,
    rimWidth: 180,
    noise: { frequency: 0.0032, amplitude: 24 },
    floorLift: 20
  },

  // NEW: procedural craters field (from the right-side config). Streamer may ignore unless implemented.
  craters: {
    enabled: true,
    spacing: 1400,
    chance: 0.18,
    radius: [160, 320],
    depth: [30, 120],
  },

  // ─────────────────────────── EXTRA SURFACE FX ─────────────────────
  lakes: {
    enabled: true,
    minRadius: 40,
    maxRadius: 180,
    attemptsPerChunk: 3,
    maxSlope: 0.12,
    minHeight: null, // defaults: waterLevel - 6
    maxHeight: null, // defaults: waterLevel + 40
    irregularity: { frequency: 0.01, amplitude: 0.18 }
  },

  dunes: { enabled: true, frequency: 0.012, amplitude: 2.0 }, // desert ripples

  // ───────────────────────────── FEATURES ───────────────────────────
  features: {
    mountains: true, rocks: true, towns: true, rivers: true,
    forests: true, lakes: true, ruins: true, roads: true, ocean: true,
    // from right-side config:
    stars: true,
  },

  // ─────────────────────── COLOR RAMPS / BIOMES ─────────────────────
  colors: {
    low: '#2f5b2f', mid: '#4e7741', high: '#c2c5c7',
    lowThreshold: 30, highThreshold: 140, highCap: 300,
    ramps: {
      ocean:   ['#0d2742', '#174d79', '#1c5e90'],
      beach:   ['#e7d5a5', '#f0e2b8'],
      grass:   ['#3e6c34', '#4f8440', '#5f9447'],
      forest:  ['#2e4f2b', '#355c31', '#3e6a38'],
      rock:    ['#7f7f7f', '#9a9a9a', '#bcbcbc'],
      snow:    ['#e6eff6', '#ffffff'],
      desert:  ['#b58b49', '#d5b46b', '#edd28f'],
      tundra:  ['#6f8f60', '#8aa37a'],
      crater:  ['#5a5450', '#6d6762', '#8c8680']
    },
  },

  biomes: {
    rules: [
      { name: 'ocean',  when: { heightBelow: 18 } },
      { name: 'beach',  when: { heightBetween: [18, 28] } },
      { name: 'tundra', when: { heightAbove: 200, temperatureBelow: -0.2 } },
      { name: 'snow',   when: { heightAbove: 220 } },
      { name: 'desert', when: { temperatureAbove: 0.35, moistureBelow: -0.2 } },
      { name: 'forest', when: { moistureAbove: 0.25, heightBelow: 200 } },
      { name: 'grass',  when: { default: true } },
    ],
    vegetation: {
      forest: { trees: 180, shrubs: 280, grass: 900 },
      grass:  { trees: 40, shrubs: 140, grass: 600 },
      tundra: { trees: 4,  shrubs: 30,  grass: 200 },
      desert: { trees: 1,  shrubs: 12,  grass: 40  },
      snow:   { trees: 0,  shrubs: 2,   grass: 4   },
      beach:  { palms: 14, shrubs: 22,  grass: 60  },
    },
  },

  // ───────────────────────── POIs: Mountains/Rocks/Towns ───────────
  mountains: {
    noise: { frequency: 0.00032, offset: [300, -220], octaves: 5, persistence: 0.58, lacunarity: 2.18 },
    threshold: 0.64,
    clusterThreshold: 0.78,
    clusterCount: 3,
    minHeight: 130,
    maxSlope: 0.56,
    heightGain: { min: 140, max: 360 },
    radius: { min: 60, max: 160 },
    segments: { min: 9, max: 14 },
    snowCapBias: 16,
  },

  rocks: {
    noise: { frequency: 0.00135, offset: [1200, -860] },
    baseCount: 3,
    densityScale: 6.2,
    attempts: 7,
    maxSlope: 0.47,
    size: { min: 6, max: 28 },
    detailThreshold: 0.55,
    breakIntoShardsChance: 0.2,
  },

  towns: {
    noise: { frequency: 0.00022, offset: [1480, -930], octaves: 4, persistence: 0.6, lacunarity: 2.3 },
    threshold: 0.66,
    anchor: { attempts: 14, maxSlope: 0.18, maxHeight: 180 },
    plazaRadius: { min: 16, max: 28 },
    buildingCount: { min: 5, max: 10 },
    buildingDistance: { offset: 9, range: 36 },
    buildingWidth: { min: 12, max: 28 },
    buildingDepth: { min: 10, max: 30 },
    wallHeight: { min: 12, max: 22 },
    roofHeightScale: 0.62,
    buildingPlacementMaxSlope: 0.23,
    connectRoads: true,
  },

  // ─────────────────────────── Rivers & Lakes ──────────────────────
  rivers: {
    // base
    noise: { frequency: 0.00036, offset: [-510, 740] },
    threshold: 0.082,
    lengthMultiplier: 1.6,
    width: { min: 24, max: 60 },
    meander: { frequency: 0.0012, scale: 0.62 },
    angleNoise: { frequency: 0.0006, offset: [2200, -1800] },
    depth: 3.2,
    segments: 20,
    springsPerTile: 2,
    lakes: { enabled: true, threshold: 0.67, minRadius: 18, maxRadius: 80 },

    // extra tunables from right-side config (compatible)
    tFrequency: 0.002, // optional temporal factor for meander anim/synthesis
  },

  // ─────────────────────── Ruins / Points of Interest ──────────────
  ruins: {
    enabled: true,
    noise: { frequency: 0.00085, offset: [5200, -4100] },
    chance: 0.12,
    cluster: { min: 1, max: 3 },
    size: { min: 8, max: 20 },
    elevationBias: [40, 160],
  },

  // ───────────────────────────── PERFORMANCE ───────────────────────
  perf: {
    lodDensity: 1.0,
    colliderDetail: 1.0,
    meshDetail: 1.0,
    spawnBudgetMs: 3.0,
    asyncErosion: true,
    cullDistance: 5600,
  },

  // ─────────────────────────── MATERIAL / STYLING ──────────────────
  materials: {
    terrainUVScale: 0.0028,
    triplanarSharpness: 2.0,
    wetnessNearWater: true,
    splat: { grass: 0.48, rock: 0.28, dirt: 0.14, snow: 0.10 },
  },

  // Backward compat quick color
  groundColor: '#6f8f60',
};

// ───────────────────────────── PRESETS ─────────────────────────────

// Ultra: more detail, more erosion, higher densities, bigger volcano
export const PRESET_ULTRA = merge(DEFAULT_GENERATOR_CONFIG, {
  meta: { name: 'TerraGen v2++ – ultra' },
  erosion: { iterations: 70 },
  perf: { lodDensity: 1.8, colliderDetail: 1.3, meshDetail: 1.35, spawnBudgetMs: 4.5 },
  noise: { detail: { frequency: 0.0072, octaves: 4, persistence: 0.48, amplitude: 10 }, warp: { amplitude: 150 } },
  volcanoes: [
    { enabled: true, center: [2400, -1800], baseRadius: 1400, height: 1000, craterRadius: 260, craterDepth: 220,
      rimSharpness: 2.4, floorLift: 45, noise: { frequency: 0.0025, amplitude: 80 },
      lava: { color: '#ff5a1f', emissive: '#ff8a00', emissiveIntensity: 1.8, levelOffset: -14 } }
  ],
  crater: { enabled: true, center: [3100, -2200], baseRadius: 820, depth: 260, rimHeight: 110, rimWidth: 220 }
});

// Fast: laptop-safe; lighter rivers & mesh detail
export const PRESET_FAST = merge(DEFAULT_GENERATOR_CONFIG, {
  meta: { name: 'TerraGen v2++ – fast' },
  erosion: { enabled: true, iterations: 14 },
  perf: { lodDensity: 0.55, colliderDetail: 0.75, meshDetail: 0.8, spawnBudgetMs: 2.2 },
  rivers: { segments: 14, width: { min: 20, max: 42 } },
  volcanoes: [{ enabled: true, center: [900, -600], baseRadius: 900, height: 620, craterRadius: 180, craterDepth: 140 }]
});

// Stylized low-poly: flatter surfaces, bold silhouettes
export const PRESET_STYLIZED = merge(DEFAULT_GENERATOR_CONFIG, {
  meta: { name: 'TerraGen v2++ – stylized' },
  erosion: { enabled: false },
  noise: {
    hills: { frequency: 0.0011, octaves: 3, persistence: 0.5, amplitude: 48 },
    mountains: { amplitude: 280, exponent: 2.4 },
    ridges: { amplitude: 16, exponent: 1.4 },
    detail: { amplitude: 0 },
  },
  materials: { triplanarSharpness: 5.0 },
  perf: { lodDensity: 0.8, meshDetail: 0.7 },
  dunes: { enabled: true, frequency: 0.01, amplitude: 3.0 }
});

// Archipelago / water-heavy world
export const PRESET_ARCHIPELAGO = merge(DEFAULT_GENERATOR_CONFIG, {
  meta: { name: 'TerraGen v2++ – archipelago' },
  world: { waterLevel: 32, beachBand: 14 },
  noise: {
    hills: { frequency: 0.0016, amplitude: 42 },
    mountains: { amplitude: 220 },
    warp: { frequency: 0.00095, amplitude: 210 },
  },
  rivers: { enabled: false },
  volcanoes: [],
  crater: { enabled: false },
  biomes: { rules: [
    { name: 'ocean', when: { heightBelow: 32 } },
    { name: 'beach', when: { heightBetween: [32, 46] } },
    { name: 'forest', when: { moistureAbove: 0.25, heightBelow: 180 } },
    { name: 'grass',  when: { default: true } },
  ]},
});

// Alpine: cold, steep, snowy
export const PRESET_ALPINE = merge(DEFAULT_GENERATOR_CONFIG, {
  meta: { name: 'TerraGen v2++ – alpine' },
  world: { snowline: 180, waterLevel: 12 },
  noise: { mountains: { amplitude: 400, exponent: 3.4 }, ridges: { amplitude: 28, exponent: 1.8 } },
  rivers: { segments: 24, depth: 3.6 },
  colors: { ramps: { snow: ['#e7f2fb', '#ffffff'] } },
  biomes: { rules: [
    { name: 'ocean', when: { heightBelow: 12 } },
    { name: 'beach', when: { heightBetween: [12, 22] } },
    { name: 'snow',  when: { heightAbove: 180 } },
    { name: 'tundra', when: { heightBetween: [120, 180] } },
    { name: 'forest', when: { moistureAbove: 0.2, heightBelow: 120 } },
    { name: 'grass',  when: { default: true } },
  ]},
  dunes: { enabled: false },
});

// Desert dunes: hot, dry, sweeping shapes
export const PRESET_DESERT = merge(DEFAULT_GENERATOR_CONFIG, {
  meta: { name: 'TerraGen v2++ – desert' },
  world: { waterLevel: 6, beachBand: 4 },
  climate: {
    temperature: { frequency: 0.00012, offset: [6400, -1100] },
    moisture: { frequency: 0.00028, offset: [2100, 900] },
  },
  noise: {
    hills: { frequency: 0.0010, amplitude: 30 },
    mountains: { amplitude: 120, exponent: 2.1 },
    ridges: { frequency: 0.0019, amplitude: 34, exponent: 1.3 },
    detail: { frequency: 0.0085, amplitude: 5 },
    warp: { frequency: 0.0011, amplitude: 160 },
  },
  rivers: { enabled: false },
  biomes: { rules: [
    { name: 'ocean',  when: { heightBelow: 6 } },
    { name: 'desert', when: { temperatureAbove: 0.2, moistureBelow: -0.1 } },
    { name: 'grass',  when: { default: true } },
  ]},
  colors: { ramps: { desert: ['#b58b49', '#d5b46b', '#edd28f'] } },
  dunes: { enabled: true, frequency: 0.014, amplitude: 3.2 },
  volcanoes: [{ enabled: true, center: [1500, 500], baseRadius: 950, height: 700, craterRadius: 190, craterDepth: 140 }]
});

// Lunar: low water, lots of craters, gray palette, no forests/rivers
export const PRESET_LUNAR = merge(DEFAULT_GENERATOR_CONFIG, {
  meta: { name: 'TerraGen v2++ – lunar' },
  world: { waterLevel: -9999, beachBand: 0, snowline: 99999 },
  features: { mountains: false, rocks: true, towns: false, rivers: false, forests: false, lakes: false, ruins: false, roads: false, ocean: false },
  colors: {
    low: '#4b4b4b', mid: '#6a6a6a', high: '#9a9a9a',
    lowThreshold: -9999, highThreshold: 99999, highCap: 99999,
    ramps: { rock: ['#4b4b4b','#6a6a6a','#9a9a9a'] }
  },
  crater: { enabled: true, center: [0,0], baseRadius: 900, depth: 260, rimHeight: 120, rimWidth: 260, noise: { frequency: 0.004, amplitude: 18 } },
  craters: { enabled: true, spacing: 1100, chance: 0.28, radius: [120, 560], depth: [40, 260] },
  volcanoes: [],
  dunes: { enabled: false },
});

// Martian: red deserts, big shield volcano + many craters
export const PRESET_MARTIAN = merge(DEFAULT_GENERATOR_CONFIG, {
  meta: { name: 'TerraGen v2++ – martian' },
  world: { waterLevel: -9999, beachBand: 0, snowline: 9999 },
  colors: {
    low: '#6b3626', mid: '#8c4a2f', high: '#c07b56',
    lowThreshold: -9999, highThreshold: 99999, highCap: 99999,
    ramps: { desert: ['#6b3626','#8c4a2f','#c07b56'], rock: ['#6b4c3a','#8b6a54','#b08d73'] }
  },
  biomes: { rules: [ { name: 'desert', when: { default: true } } ] },
  dunes: { enabled: true, frequency: 0.010, amplitude: 2.6 },
  volcanoes: [{
    enabled: true, center: [0,0], baseRadius: 2200, height: 1800,
    craterRadius: 420, craterDepth: 280, rimSharpness: 2.0, floorLift: 30,
    noise: { frequency: 0.002, amplitude: 90 },
    lava: { color: '#ff4d1a', emissive: '#ff7a3a', emissiveIntensity: 1.2, levelOffset: -22 }
  }],
  crater: { enabled: true, center: [-1800, 900], baseRadius: 1200, depth: 340, rimHeight: 160, rimWidth: 320 },
  craters: { enabled: true, spacing: 1500, chance: 0.22, radius: [200, 900], depth: [50, 420] },
  rivers: { enabled: false },
  features: { forests: false, lakes: false, towns: false, roads: false, ocean: false }
});

// Tiny Planet: small bounded world (good for walkable mini planet vibes)
export const PRESET_TINY_PLANET = merge(DEFAULT_GENERATOR_CONFIG, {
  meta: { name: 'TerraGen v2++ – tiny planet' },
  world: { bounds: { minX: -8000, maxX: 8000, minY: -8000, maxY: 8000 }, tileSize: 600, visibleRadius: 4, waterLevel: 14, beachBand: 10 },
  noise: { warp: { frequency: 0.0012, amplitude: 80 } },
  volcanoes: [{ enabled: true, center: [1200, -600], baseRadius: 650, height: 520, craterRadius: 140, craterDepth: 120 }],
  crater: { enabled: true, center: [-900, 400], baseRadius: 520, depth: 180, rimHeight: 80, rimWidth: 160 },
});

// ─────────────────────────── EXPORT PRESETS ─────────────────────────
export const TERRAIN_PRESETS = {
  default: DEFAULT_GENERATOR_CONFIG, // rich v2++ default
  ultra: PRESET_ULTRA,
  fast: PRESET_FAST,
  stylized: PRESET_STYLIZED,
  archipelago: PRESET_ARCHIPELAGO,
  alpine: PRESET_ALPINE,
  desert: PRESET_DESERT,
  lunar: PRESET_LUNAR,
  martian: PRESET_MARTIAN,
  tiny_planet: PRESET_TINY_PLANET,

  // Also export a “right-side-default-like” preset in case you want that feel exactly
  // without touching the main default:
  classic_default: merge(DEFAULT_GENERATOR_CONFIG, {
    seed: 982451653,
    world: { tileSize: 640, visibleRadius: 3, waterLevel: 6, snowline: 280, beachBand: 14 },
    noise: {
      warp: { frequency: 0.0004, amplitude: 260, offset: [1.1, -2.3] },
      hills: { frequency: 0.0008, amplitude: 60, octaves: 4, persistence: 0.55, lacunarity: 2.1 },
      mountains: { frequency: 0.00045, amplitude: 260, octaves: 5, persistence: 0.5, lacunarity: 2.05, exponent: 2.2 },
      ridges: { frequency: 0.001, amplitude: 48, exponent: 2.4 },
      detail: { frequency: 0.006, amplitude: 18, octaves: 3, persistence: 0.5, lacunarity: 2.3 },
    },
    mountains: {
      noise: { frequency: 0.00038, octaves: 4, persistence: 0.58, lacunarity: 2.2 },
      threshold: 0.6, clusterThreshold: 0.78, clusterCount: 2,
      minHeight: 140, maxSlope: 0.55,
      heightGain: { min: 160, max: 360 },
      radius: { min: 60, max: 160 },
      segments: { min: 8, max: 12 },
      locationAttempts: 12,
    },
    rocks: { noise: { frequency: 0.0012 }, baseCount: 2, densityScale: 5, size: { min: 4, max: 18 }, detailThreshold: 0.4, attempts: 6, maxSlope: 0.48 },
    towns: {
      noise: { frequency: 0.00028, octaves: 4, persistence: 0.62, lacunarity: 2.4 },
      threshold: 0.7, anchor: { attempts: 10, maxSlope: 0.2, maxHeight: 200 },
      plazaRadius: { min: 16, max: 26 }, buildingCount: { min: 4, max: 9 },
      buildingWidth: { min: 12, max: 22 }, buildingDepth: { min: 10, max: 24 },
      wallHeight: { min: 12, max: 22 }, roofHeightScale: 0.6,
      buildingDistance: { offset: 8, range: 24 }, buildingPlacementMaxSlope: 0.22,
    },
    climate: { temperature: { frequency: 0.00018, offset: [0.2, 1.1] }, moisture: { frequency: 0.00025, offset: [-1.3, 0.6] } },
    colors: {
      low: '#466e3c', mid: '#6fa360', high: '#d8dbe2', lowThreshold: 22, highThreshold: 140, highCap: 360,
      ramps: {
        grass: [ '#35553b', '#5f9a5f', '#98c788' ],
        beach: [ '#bca876', '#e8d39d' ],
        ocean: [ '#13273f', '#1c3b62', '#2f5c86' ],
        snow: [ '#dfe8f0', '#f9fbff' ],
        rock: [ '#5b5c63', '#7a7c84', '#b9bbc6' ],
      },
    },
    features: { stars: true },
    rivers: {
      noise: { frequency: 0.0004 },
      angleNoise: { frequency: 0.00054 },
      meander: { frequency: 0.0008 },
      tFrequency: 0.002,
      threshold: 0.1, lengthMultiplier: 1.5, width: { min: 24, max: 56 }, depth: 3.2,
      lakes: { enabled: true, perChunk: 1, noiseFrequency: 0.0009, threshold: 0.55, radius: [26, 60], levelOffset: -1.6 },
    },
    volcano: { enabled: false },
  }),
};
