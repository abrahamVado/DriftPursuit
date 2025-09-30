export function cloneEnvironment(environment){
  if (!environment || typeof environment !== 'object') return null;
  const clone = { ...environment };
  if (environment.fog && typeof environment.fog === 'object'){
    clone.fog = { ...environment.fog };
  }
  if (environment.sun && typeof environment.sun === 'object'){
    clone.sun = { ...environment.sun };
  }
  if (environment.hemisphere && typeof environment.hemisphere === 'object'){
    clone.hemisphere = { ...environment.hemisphere };
  }
  return clone;
}

export function cloneHeightfieldDescriptor(descriptor){
  if (!descriptor || typeof descriptor !== 'object') return null;
  const clone = { ...descriptor };
  if (Array.isArray(descriptor.data)){
    clone.data = [...descriptor.data];
  }
  return clone;
}

export function cloneTileObjects(objects){
  if (!Array.isArray(objects)) return [];
  return objects.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    return { ...entry };
  });
}

export function cloneTileDescriptor(tile){
  if (!tile || typeof tile !== 'object') return tile;
  const clone = { ...tile };
  if (Array.isArray(tile.coords)) clone.coords = [...tile.coords];
  if (Array.isArray(tile.coordinates)) clone.coordinates = [...tile.coordinates];
  if (tile.heightfield && typeof tile.heightfield === 'object'){
    clone.heightfield = cloneHeightfieldDescriptor(tile.heightfield);
  }
  if (Array.isArray(tile.objects)){
    clone.objects = cloneTileObjects(tile.objects);
  }
  return clone;
}

export function cloneProceduralConfig(config){
  if (!config || typeof config !== 'object') return null;
  try {
    return JSON.parse(JSON.stringify(config));
  } catch (error){
    console.warn('Failed to clone procedural configuration', error);
    return null;
  }
}

export function cloneMapDescriptor(descriptor){
  if (!descriptor || typeof descriptor !== 'object') return null;
  const clone = { ...descriptor };
  if (descriptor.environment) clone.environment = cloneEnvironment(descriptor.environment);
  if (descriptor.procedural && typeof descriptor.procedural === 'object'){
    const proceduralClone = cloneProceduralConfig(descriptor.procedural);
    if (proceduralClone) clone.procedural = proceduralClone;
  }
  if (descriptor.generator && typeof descriptor.generator === 'object'){
    const generatorClone = cloneProceduralConfig(descriptor.generator);
    if (generatorClone) clone.generator = generatorClone;
  }
  if (Array.isArray(descriptor.tiles)){
    clone.tiles = descriptor.tiles.map((tile) => cloneTileDescriptor(tile));
  }
  if (descriptor.fallback && typeof descriptor.fallback === 'object'){
    clone.fallback = { ...descriptor.fallback };
  }
  return clone;
}

export function cloneMapDefinition(entry){
  if (!entry || typeof entry !== 'object') return null;
  const clone = { ...entry };
  if (clone.environment) clone.environment = cloneEnvironment(clone.environment);
  if (clone.procedural && typeof clone.procedural === 'object'){
    const proceduralClone = cloneProceduralConfig(clone.procedural);
    if (proceduralClone) clone.procedural = proceduralClone;
    else delete clone.procedural;
  }
  if (clone.generator && typeof clone.generator === 'object'){
    const generatorClone = cloneProceduralConfig(clone.generator);
    if (generatorClone) clone.generator = generatorClone;
    else delete clone.generator;
  }
  if (Array.isArray(clone.tiles)) clone.tiles = clone.tiles.map((tile) => cloneTileDescriptor(tile));
  if (clone.descriptor) clone.descriptor = cloneMapDescriptor(clone.descriptor);
  if (clone.fallback && typeof clone.fallback === 'object') clone.fallback = { ...clone.fallback };
  return clone;
}

export function mergeTileDescriptor({ mapEntry, descriptor, descriptorUrl }){
  const merged = cloneMapDescriptor(descriptor) ?? {};
  if (mapEntry){
    if (!merged.id && mapEntry.id) merged.id = mapEntry.id;
    const typeValue = typeof mapEntry.type === 'string' ? mapEntry.type.toLowerCase() : mapEntry.type;
    if (!merged.type && typeValue) merged.type = typeValue;
    if (!merged.tileSize && Number.isFinite(mapEntry.tileSize)) merged.tileSize = mapEntry.tileSize;
    if (!merged.visibleRadius && Number.isFinite(mapEntry.visibleRadius)) merged.visibleRadius = mapEntry.visibleRadius;
    if (!merged.assetRoot && typeof mapEntry.assetRoot === 'string') merged.assetRoot = mapEntry.assetRoot;
    if (!Array.isArray(merged.tiles) && Array.isArray(mapEntry.tiles)){
      merged.tiles = mapEntry.tiles.map((tile) => cloneTileDescriptor(tile));
    }
  }
  if (descriptorUrl){
    const source = descriptorUrl.toString();
    merged.descriptorSource = source;
    if (typeof merged.assetRoot === 'string' && merged.assetRoot.length > 0){
      try {
        const assetUrl = new URL(merged.assetRoot, descriptorUrl);
        merged.assetRoot = assetUrl.toString();
      } catch (error){
        // Keep provided assetRoot if URL resolution fails.
      }
    }
  }
  if (!Array.isArray(merged.tiles)){
    merged.tiles = [];
  }
  return merged;
}

function cloneFallbackMaps(fallbackMaps){
  if (!Array.isArray(fallbackMaps)) return [];
  return fallbackMaps.map((entry) => cloneMapDefinition(entry)).filter(Boolean);
}

export async function loadMapDefinitions({
  endpoint,
  requestedId,
  fetchFn,
  fallbackMaps = [],
  fallbackDefaultId = null,
  origin,
} = {}){
  const fallbackResult = {
    maps: cloneFallbackMaps(fallbackMaps),
    defaultId: fallbackDefaultId ?? fallbackMaps[0]?.id ?? null,
  };

  if (typeof fetchFn !== 'function' || !endpoint){
    return fallbackResult;
  }

  try {
    const options = requestedId ? { headers: { 'X-Active-Map': requestedId } } : undefined;
    const response = await fetchFn(endpoint, options);
    if (!response || !response.ok){
      throw new Error(`Failed to fetch maps: ${response?.status ?? 'unknown status'}`);
    }
    const data = await response.json();
    const rawMaps = Array.isArray(data?.maps)
      ? data.maps
      : Array.isArray(data)
        ? data
        : [];

    const originValue = origin ?? (typeof window !== 'undefined' ? window.location.href : 'http://localhost/');
    const baseUrl = new URL(endpoint, originValue);

    const maps = await Promise.all(
      rawMaps.map(async (entry) => {
        const mapEntry = cloneMapDefinition(entry);
        if (!mapEntry) return null;

        if (typeof mapEntry.type === 'string'){
          mapEntry.type = mapEntry.type.toLowerCase();
        }

        if (mapEntry.type === 'tilemap'){
          let descriptorUrl = null;
          if (typeof mapEntry.path === 'string' && mapEntry.path.length > 0){
            try {
              descriptorUrl = new URL(mapEntry.path, baseUrl);
            } catch (error){
              console.warn(`Invalid descriptor path for tile map ${mapEntry.id}`, error);
            }
          }

          let descriptorSource = mapEntry.descriptor ? cloneMapDescriptor(mapEntry.descriptor) : null;

          if (!descriptorSource && descriptorUrl){
            try {
              const descriptorResponse = await fetchFn(descriptorUrl.toString(), { cache: 'no-cache' });
              if (!descriptorResponse.ok){
                console.warn(`Failed to load tile-map descriptor for ${mapEntry.id}: HTTP ${descriptorResponse.status}`);
              } else {
                const descriptorData = await descriptorResponse.json();
                descriptorSource = cloneMapDescriptor(descriptorData);
              }
            } catch (error){
              console.warn(`Failed to load tile-map descriptor for ${mapEntry.id}`, error);
            }
          }

          if (descriptorSource){
            const merged = mergeTileDescriptor({ mapEntry, descriptor: descriptorSource, descriptorUrl });
            mapEntry.descriptor = merged;
            if (!Array.isArray(mapEntry.tiles) && Array.isArray(merged.tiles)){
              mapEntry.tiles = merged.tiles.map((tile) => cloneTileDescriptor(tile));
            }
            if (!Number.isFinite(mapEntry.tileSize) && Number.isFinite(merged.tileSize)){
              mapEntry.tileSize = merged.tileSize;
            }
            if (!Number.isFinite(mapEntry.visibleRadius) && Number.isFinite(merged.visibleRadius)){
              mapEntry.visibleRadius = merged.visibleRadius;
            }
          } else {
            mapEntry.descriptor = mergeTileDescriptor({
              mapEntry,
              descriptor: {
                id: mapEntry.id,
                type: 'tilemap',
                tiles: Array.isArray(mapEntry.tiles) ? mapEntry.tiles : [],
              },
              descriptorUrl,
            });
          }
        }

        return mapEntry;
      }),
    );

    const sanitizedMaps = maps.filter(Boolean);
    const defaultId = typeof data?.default === 'string'
      ? data.default
      : sanitizedMaps[0]?.id ?? fallbackResult.defaultId;

    return { maps: sanitizedMaps, defaultId };
  } catch (error){
    console.warn('Falling back to bundled map definitions.', error);
    return fallbackResult;
  }
}

export function selectMapDefinition({ maps, requestedId, fallbackId, fallbackMaps = [] } = {}){
  const mapList = Array.isArray(maps) && maps.length > 0
    ? maps.map((entry) => cloneMapDefinition(entry)).filter(Boolean)
    : cloneFallbackMaps(fallbackMaps);

  const registry = new Map();
  mapList.forEach((entry) => {
    if (entry?.id){
      registry.set(entry.id, entry);
    }
  });

  let targetId = requestedId && registry.has(requestedId) ? requestedId : null;
  if (!targetId && fallbackId && registry.has(fallbackId)){
    targetId = fallbackId;
  }
  if (!targetId){
    targetId = mapList.find((entry) => entry?.id)?.id ?? fallbackMaps[0]?.id ?? null;
  }

  const selected = targetId ? registry.get(targetId) ?? mapList[0] : mapList[0];
  return {
    selected,
    id: selected?.id ?? targetId ?? null,
    registry,
    maps: mapList,
  };
}
