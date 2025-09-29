import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMapManifestUrl,
  deriveAssetRootFromUrl,
  normalizeMapDescriptor,
} from '../mapNormalization.mjs';

const TILEMAP_ENTRY = {
  id: 'hangar',
  type: 'tilemap',
  path: 'hangar\\map.json',
  tileSize: 900,
};

const TILEMAP_DESCRIPTOR = {
  type: 'tilemap',
  path: 'hangar\\map.json',
  tiles: [],
};

test('normalizes Windows-authored tilemap manifest paths', () => {
  const manifestUrl = buildMapManifestUrl(TILEMAP_ENTRY.path);
  assert.equal(
    manifestUrl,
    'assets/maps/hangar/map.json',
    'manifest URL should flip backslashes to forward slashes',
  );

  assert.equal(
    deriveAssetRootFromUrl(manifestUrl),
    'assets/maps/hangar/',
    'asset root should be derived from the normalized manifest URL',
  );

  const normalizedDescriptor = normalizeMapDescriptor(
    TILEMAP_DESCRIPTOR,
    TILEMAP_ENTRY,
  );

  assert.equal(
    normalizedDescriptor.assetRoot,
    'assets/maps/hangar/',
    'tilemap descriptors should expose a normalized asset root',
  );
});
