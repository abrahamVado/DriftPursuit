function findLocation({
  chunkX,
  chunkY,
  rng,
  chunkSize,
  sampleHeight,
  slopeMagnitude,
  attempts = 8,
  minHeight = -Infinity,
  maxHeight = Infinity,
  maxSlope = 0.5,
}){
  for (let attempt = 0; attempt < attempts; attempt += 1){
    const localX = (rng() - 0.5) * chunkSize * 0.9;
    const localY = (rng() - 0.5) * chunkSize * 0.9;
    const worldX = chunkX * chunkSize + localX;
    const worldY = chunkY * chunkSize + localY;
    const height = sampleHeight(worldX, worldY);
    if (height < minHeight || height > maxHeight) continue;
    const slope = slopeMagnitude(worldX, worldY);
    if (slope > maxSlope) continue;
    return { localX, localY, worldX, worldY, height, slope };
  }
  return null;
}

function maybeAddMountain(ctx){
  const {
    chunkX, chunkY, rng, group, obstacles,
    generatorConfig, chunkSize, noise, materials, THREE,
    sampleHeight, slopeMagnitude,
  } = ctx;
  const centerX = (chunkX + 0.5) * chunkSize;
  const centerY = (chunkY + 0.5) * chunkSize;
  const config = generatorConfig.mountains ?? {};
  const noiseCfg = config.noise ?? {};
  const mountainNoise = noise.fractal2(
    centerX * (noiseCfg.frequency ?? 0) + (noiseCfg.offset?.[0] ?? 0),
    centerY * (noiseCfg.frequency ?? 0) + (noiseCfg.offset?.[1] ?? 0),
    { octaves: noiseCfg.octaves ?? 5, persistence: noiseCfg.persistence ?? 0.58, lacunarity: noiseCfg.lacunarity ?? 2.18 },
  );
  const threshold = config.threshold ?? 0.64;
  if (mountainNoise < threshold) return;

  const clusterThreshold = config.clusterThreshold ?? threshold + 0.14;
  const maxClusters = Math.max(1, Math.round(config.clusterCount ?? 2));
  const clusterCount = mountainNoise > clusterThreshold ? maxClusters : 1;
  const attempts = config.locationAttempts ?? 10;
  for (let c = 0; c < clusterCount; c += 1){
    const location = findLocation({
      chunkX,
      chunkY,
      rng,
      chunkSize,
      sampleHeight,
      slopeMagnitude,
      attempts,
      minHeight: config.minHeight ?? 120,
      maxSlope: config.maxSlope ?? 0.55,
    });
    if (!location) break;

    const baseHeight = location.height;
    const heightMin = config.heightGain?.min ?? 120;
    const heightMax = config.heightGain?.max ?? 340;
    const heightGain = heightMin + rng() * Math.max(0, heightMax - heightMin);
    const radiusMin = config.radius?.min ?? 60;
    const radiusMax = config.radius?.max ?? 150;
    const radius = radiusMin + rng() * Math.max(0, radiusMax - radiusMin);
    const segmentsMin = Math.max(3, Math.round(config.segments?.min ?? 8));
    const segmentsMax = Math.max(segmentsMin, Math.round(config.segments?.max ?? 12));
    const segmentSpan = segmentsMax - segmentsMin + 1;
    const segments = segmentsMin + Math.floor(rng() * segmentSpan);

    const geometry = new THREE.ConeGeometry(radius, heightGain, segments);
    const mesh = new THREE.Mesh(geometry, materials.mountain);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(location.localX, location.localY, baseHeight + heightGain / 2);
    group.add(mesh);

    const peakHeight = baseHeight + heightGain;
    obstacles.push({
      mesh,
      radius: radius * 0.95,
      worldPosition: new THREE.Vector3(location.worldX, location.worldY, peakHeight),
      topHeight: peakHeight,
      baseHeight,
      type: 'mountain',
    });
  }
}

function scatterRocks(ctx){
  const {
    chunkX, chunkY, rng, group, obstacles,
    generatorConfig, chunkSize, noise, materials, THREE,
    sampleHeight, slopeMagnitude,
  } = ctx;
  const centerX = (chunkX + 0.5) * chunkSize;
  const centerY = (chunkY + 0.5) * chunkSize;
  const config = generatorConfig.rocks ?? {};
  const noiseCfg = config.noise ?? {};
  const densityNoise = noise.perlin2(
    centerX * (noiseCfg.frequency ?? 0) + (noiseCfg.offset?.[0] ?? 0),
    centerY * (noiseCfg.frequency ?? 0) + (noiseCfg.offset?.[1] ?? 0),
  );
  const countBase = config.baseCount ?? 2;
  const countScale = config.densityScale ?? 6;
  const rawCount = Math.floor(countBase + densityNoise * countScale);
  const count = Math.max(0, rawCount);
  for (let i = 0; i < count; i += 1){
    const location = findLocation({
      chunkX,
      chunkY,
      rng,
      chunkSize,
      sampleHeight,
      slopeMagnitude,
      attempts: config.attempts ?? 6,
      maxSlope: config.maxSlope ?? 0.45,
    });
    if (!location) break;
    const sizeMin = config.size?.min ?? 6;
    const sizeMax = config.size?.max ?? 24;
    const size = sizeMin + rng() * Math.max(0, sizeMax - sizeMin);
    const detailThreshold = config.detailThreshold ?? 0.55;
    const detail = rng() > detailThreshold ? 1 : 0;
    const geometry = new THREE.DodecahedronGeometry(size, detail);
    const mesh = new THREE.Mesh(geometry, materials.rock);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(location.localX, location.localY, location.height + size * 0.45);
    group.add(mesh);

    obstacles.push({
      mesh,
      radius: size * 0.8,
      worldPosition: new THREE.Vector3(location.worldX, location.worldY, location.height + size),
      topHeight: location.height + size * 1.2,
      baseHeight: location.height,
      type: 'rock',
    });
  }
}

function maybeAddTown(ctx){
  const {
    chunkX, chunkY, rng, group, obstacles,
    generatorConfig, chunkSize, noise, materials, THREE,
    sampleHeight, slopeMagnitude,
  } = ctx;
  const centerX = (chunkX + 0.5) * chunkSize;
  const centerY = (chunkY + 0.5) * chunkSize;
  const config = generatorConfig.towns ?? {};
  const noiseCfg = config.noise ?? {};
  const settlementNoise = noise.fractal2(
    centerX * (noiseCfg.frequency ?? 0) + (noiseCfg.offset?.[0] ?? 0),
    centerY * (noiseCfg.frequency ?? 0) + (noiseCfg.offset?.[1] ?? 0),
    { octaves: noiseCfg.octaves ?? 4, persistence: noiseCfg.persistence ?? 0.6, lacunarity: noiseCfg.lacunarity ?? 2.3 },
  );
  if (settlementNoise < (config.threshold ?? 0.66)) return;

  const anchorCfg = config.anchor ?? {};
  const anchor = findLocation({
    chunkX,
    chunkY,
    rng,
    chunkSize,
    sampleHeight,
    slopeMagnitude,
    attempts: anchorCfg.attempts ?? 12,
    maxSlope: anchorCfg.maxSlope ?? 0.18,
    maxHeight: anchorCfg.maxHeight ?? 180,
  });
  if (!anchor) return;

  const townGroup = new THREE.Group();
  townGroup.name = `Town_${chunkX}_${chunkY}`;
  group.add(townGroup);

  const plazaMin = config.plazaRadius?.min ?? 16;
  const plazaMax = config.plazaRadius?.max ?? 26;
  const plazaRadius = plazaMin + rng() * Math.max(0, plazaMax - plazaMin);
  const plazaGeometry = new THREE.CircleGeometry(plazaRadius, 24);
  const plaza = new THREE.Mesh(plazaGeometry, materials.plaza);
  plaza.position.set(anchor.localX, anchor.localY, anchor.height + 0.4);
  plaza.receiveShadow = true;
  townGroup.add(plaza);

  const buildingCountMin = Math.max(0, Math.round(config.buildingCount?.min ?? 4));
  const buildingCountMax = Math.max(buildingCountMin, Math.round(config.buildingCount?.max ?? 8));
  const buildingCountRange = buildingCountMax - buildingCountMin + 1;
  const buildingCount = buildingCountMin + Math.floor(rng() * buildingCountRange);
  const buildingSlopeLimit = config.buildingPlacementMaxSlope ?? 0.24;
  for (let i = 0; i < buildingCount; i += 1){
    const angle = rng() * Math.PI * 2;
    const distance = plazaRadius + (config.buildingDistance?.offset ?? 8) + rng() * Math.max(0, config.buildingDistance?.range ?? 35);
    const worldX = anchor.worldX + Math.cos(angle) * distance;
    const worldY = anchor.worldY + Math.sin(angle) * distance;
    const slope = slopeMagnitude(worldX, worldY);
    if (slope > buildingSlopeLimit) continue;
    const height = sampleHeight(worldX, worldY);
    const widthMin = config.buildingWidth?.min ?? 12;
    const widthMax = config.buildingWidth?.max ?? 26;
    const width = widthMin + rng() * Math.max(0, widthMax - widthMin);
    const depthMin = config.buildingDepth?.min ?? 10;
    const depthMax = config.buildingDepth?.max ?? 28;
    const depth = depthMin + rng() * Math.max(0, depthMax - depthMin);
    const wallMin = config.wallHeight?.min ?? 12;
    const wallMax = config.wallHeight?.max ?? 22;
    const wallHeight = wallMin + rng() * Math.max(0, wallMax - wallMin);
    const roofHeight = wallHeight * (config.roofHeightScale ?? 0.6);

    const base = new THREE.Mesh(new THREE.BoxGeometry(width, depth, wallHeight), materials.building);
    const localX = worldX - chunkX * chunkSize;
    const localY = worldY - chunkY * chunkSize;
    base.position.set(localX, localY, height + wallHeight / 2);
    base.castShadow = true;
    base.receiveShadow = true;
    townGroup.add(base);

    const roofRadius = Math.max(width, depth) * 0.75;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(roofRadius, roofHeight, 4), materials.roof);
    roof.position.set(localX, localY, height + wallHeight + roofHeight / 2);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    roof.receiveShadow = true;
    townGroup.add(roof);

    obstacles.push({
      mesh: base,
      radius: Math.max(width, depth) * 0.6,
      worldPosition: new THREE.Vector3(worldX, worldY, height + wallHeight),
      topHeight: height + wallHeight + roofHeight,
      baseHeight: height,
      type: 'building',
    });
  }
}

function maybeAddRiver(ctx){
  const {
    chunkX, chunkY, group,
    generatorConfig, chunkSize, noise, materials, THREE,
    sampleHeight,
  } = ctx;
  const centerX = (chunkX + 0.5) * chunkSize;
  const centerY = (chunkY + 0.5) * chunkSize;
  const config = generatorConfig.rivers ?? {};
  const noiseCfg = config.noise ?? {};
  const riverNoise = noise.perlin2(
    centerX * (noiseCfg.frequency ?? 0) + (noiseCfg.offset?.[0] ?? 0),
    centerY * (noiseCfg.frequency ?? 0) + (noiseCfg.offset?.[1] ?? 0),
  ) - 0.5;
  const closeness = Math.abs(riverNoise);
  const threshold = config.threshold ?? 0.085;
  if (closeness > threshold) return;

  const angleCfg = config.angleNoise ?? {};
  const angleNoise = noise.perlin2(
    centerX * (angleCfg.frequency ?? 0) + (angleCfg.offset?.[0] ?? 0),
    centerY * (angleCfg.frequency ?? 0) + (angleCfg.offset?.[1] ?? 0),
  );
  const angle = angleNoise * Math.PI * 2;
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const perpX = -dirY;
  const perpY = dirX;
  const length = chunkSize * (config.lengthMultiplier ?? 1.5);
  const width = THREE.MathUtils.lerp(
    config.width?.min ?? 26,
    config.width?.max ?? 58,
    1 - THREE.MathUtils.clamp(closeness / Math.max(1e-6, threshold), 0, 1),
  );
  const halfWidth = width / 2;
  const segments = Math.max(2, Math.round(config.segments ?? 18));

  const positions = new Float32Array((segments + 1) * 2 * 3);
  const indices = [];

  for (let i = 0; i <= segments; i += 1){
    const t = (i / segments - 0.5) * length;
    const meanderCfg = config.meander ?? {};
    const meander = (noise.perlin2(
      centerX * (meanderCfg.frequency ?? 0.0012) + t * (meanderCfg.tFrequency ?? 0.002),
      centerY * (meanderCfg.frequency ?? 0.0012) - t * (meanderCfg.tFrequency ?? 0.002),
    ) - 0.5) * width * (meanderCfg.scale ?? 0.6);
    const centerWorldX = centerX + dirX * t + perpX * meander;
    const centerWorldY = centerY + dirY * t + perpY * meander;
    for (let side = 0; side < 2; side += 1){
      const sign = side === 0 ? -1 : 1;
      const worldX = centerWorldX + perpX * sign * halfWidth;
      const worldY = centerWorldY + perpY * sign * halfWidth;
      const height = sampleHeight(worldX, worldY) - (config.depth ?? 2.8);
      const localX = worldX - chunkX * chunkSize;
      const localY = worldY - chunkY * chunkSize;
      const index = (i * 2 + side) * 3;
      positions[index] = localX;
      positions[index + 1] = localY;
      positions[index + 2] = height;
    }
  }

  for (let i = 0; i < segments; i += 1){
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, b, d, a, d, c);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, materials.water);
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  group.add(mesh);
}

function maybeAddLakes(ctx){
  const {
    chunkX, chunkY, rng, group,
    chunkSize, noise, materials, THREE,
    sampleHeight, world, lakeConfig,
  } = ctx;
  if (!lakeConfig?.enabled) return;
  const perChunk = Math.max(0, Math.floor(lakeConfig.perChunk ?? 1));
  if (perChunk <= 0) return;

  const cx = (chunkX + 0.5) * chunkSize;
  const cy = (chunkY + 0.5) * chunkSize;
  const f = lakeConfig.noiseFrequency ?? 0.0009;
  const base = noise.perlin2(cx * f, cy * f);
  if (base < (lakeConfig.threshold ?? 0.58)) return;

  for (let i = 0; i < perChunk; i += 1){
    const jx = (rng() - 0.5) * chunkSize * 0.6;
    const jy = (rng() - 0.5) * chunkSize * 0.6;
    const wx = cx + jx;
    const wy = cy + jy;
    const h = sampleHeight(wx, wy);
    if (h > world.waterLevel + 6) continue;

    const rmin = lakeConfig.minRadius ?? lakeConfig.radius?.[0] ?? 18;
    const rmax = lakeConfig.maxRadius ?? lakeConfig.radius?.[1] ?? 80;
    const r = rmin + rng() * Math.max(0, rmax - rmin);

    const geo = new THREE.CircleGeometry(r, 32);
    const mesh = new THREE.Mesh(geo, materials.water);
    mesh.position.set(wx - chunkX * chunkSize, wy - chunkY * chunkSize, Math.min(h - 1, world.waterLevel + (lakeConfig.levelOffset ?? -2)));
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.name = 'Lake';
    group.add(mesh);
  }
}

export function scatterTerrainFeatures(ctx){
  const obstacles = [];
  const { generatorConfig } = ctx;
  const features = generatorConfig.features ?? {};
  if (features.mountains !== false) maybeAddMountain({ ...ctx, obstacles });
  if (features.rocks !== false) scatterRocks({ ...ctx, obstacles });
  if (features.towns !== false) maybeAddTown({ ...ctx, obstacles });
  if (features.rivers !== false) maybeAddRiver(ctx);
  if (ctx.lakeConfig?.enabled !== false) maybeAddLakes(ctx);
  return { obstacles };
}

export { findLocation };
