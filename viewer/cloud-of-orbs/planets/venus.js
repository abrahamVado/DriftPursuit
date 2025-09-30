import { requireTHREE } from '../../shared/threeSetup.js';
import { getPlanetMaterial } from './sharedMaterials.js';

const PLANET_ID = 'venus';

/**
 * Metadata describing Venus within the orbital view.
 * - id: Unique identifier for registry lookups.
 * - label: Human readable name displayed in UI.
 * - radius: Relative radius in Earth units (Earth = 1).
 * - orbitDistance: Average orbital distance in astronomical units (AU).
 * - loadThresholds: Distance thresholds (in scene units) for LOD transitions.
 */
export const metadata = Object.freeze({
  id: PLANET_ID,
  label: 'Venus',
  radius: 0.949,
  orbitDistance: 0.72,
  loadThresholds: {
    low: 0,
    medium: 120,
    high: 240,
  },
});

/**
 * Create a lightweight mesh representing Venus for the solar-system view.
 *
 * @param {object} [options]
 * @param {number} [options.segments=28] - Segments used for the sphere geometry.
 * @returns {THREE.Mesh}
 */
export function createOrbitalMesh({ segments = 28 } = {}){
  const THREE = requireTHREE();
  const geometry = new THREE.SphereGeometry(metadata.radius, segments, segments);
  const material = getPlanetMaterial(PLANET_ID, {
    color: 0xd4b36b,
    roughness: 0.85,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = metadata.label;
  mesh.userData = { planetId: PLANET_ID };
  return mesh;
}

/**
 * Optional hook describing Venus' surface scene for future high-detail loads.
 * @returns {null}
 */
export function createSurfaceDescriptor(){
  return null;
}

/**
 * Optional async hook to load detailed assets for Venus.
 * @returns {Promise<null>}
 */
export async function loadDetailAssets(){
  return null;
}
