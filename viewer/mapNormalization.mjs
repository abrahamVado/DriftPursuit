const WORLD_CHUNK_SIZE = 900;
const WORLD_CHUNK_RADIUS = 2;
const DEFAULT_MAP_ID = 'procedural:endless';
const WORLD_SEED = 'driftpursuit:endless';

function normalizeAssetRootPath(value){
  if (!value) return '';
  const normalized = String(value).replace(/\\/g, '/').trim();
  if (!normalized) return '';
  if (/^https?:\/\//i.test(normalized) || normalized.startsWith('/')){
    return normalized.replace(/\/?$/, '/');
  }
  return `${normalized.replace(/\/?$/, '')}/`;
}

function deriveAssetRootFromUrl(url){
  if (!url) return '';
  const normalized = String(url).replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  if (index === -1) return '';
  return normalizeAssetRootPath(normalized.slice(0, index + 1));
}

function buildMapManifestUrl(relativePath){
  if (relativePath === undefined || relativePath === null) return '';
  return `assets/maps/${String(relativePath)}`.replace(/\\/g, '/');
}

function normalizeMapDescriptor(descriptor, entry){
  if (!descriptor) return null;
  const base = { ...descriptor };
  base.id = entry?.id || descriptor.id || DEFAULT_MAP_ID;
  base.label = base.label || entry?.label || base.name || base.id;
  base.type = base.type || entry?.type || 'procedural';
  base.generator = base.generator || entry?.generator || entry?.integration;

  if (base.type === 'tilemap'){
    base.tileSize = Number(base.tileSize || entry?.tileSize || WORLD_CHUNK_SIZE) || WORLD_CHUNK_SIZE;
    const radius = Number(base.visibleRadius ?? entry?.visibleRadius ?? WORLD_CHUNK_RADIUS);
    base.visibleRadius = Number.isFinite(radius) ? radius : WORLD_CHUNK_RADIUS;
    base.fallback = base.fallback || entry?.fallback || { type: 'procedural', seed: WORLD_SEED };
    base.tiles = Array.isArray(base.tiles) ? base.tiles : [];
    const explicitAssetRoot = normalizeAssetRootPath(base.assetRoot || entry?.assetRoot || descriptor?.assetRoot || '');
    if (explicitAssetRoot){
      base.assetRoot = explicitAssetRoot;
    } else if (entry?.path){
      const resourcePath = buildMapManifestUrl(entry.path);
      base.assetRoot = deriveAssetRootFromUrl(resourcePath);
    } else if (descriptor?.path){
      base.assetRoot = deriveAssetRootFromUrl(String(descriptor.path));
    } else {
      base.assetRoot = '';
    }
  } else {
    base.type = 'procedural';
    base.seed = base.seed || entry?.seed || WORLD_SEED;
    base.chunkSize = Number(base.chunkSize || entry?.chunkSize || WORLD_CHUNK_SIZE) || WORLD_CHUNK_SIZE;
    const radius = Number(base.visibleRadius ?? entry?.visibleRadius ?? WORLD_CHUNK_RADIUS);
    base.visibleRadius = Number.isFinite(radius) ? radius : WORLD_CHUNK_RADIUS;
    const explicitAssetRoot = normalizeAssetRootPath(base.assetRoot || entry?.assetRoot || descriptor?.assetRoot || '');
    base.assetRoot = explicitAssetRoot;
  }

  return base;
}

export {
  DEFAULT_MAP_ID,
  WORLD_CHUNK_RADIUS,
  WORLD_CHUNK_SIZE,
  WORLD_SEED,
  buildMapManifestUrl,
  deriveAssetRootFromUrl,
  normalizeAssetRootPath,
  normalizeMapDescriptor,
};
