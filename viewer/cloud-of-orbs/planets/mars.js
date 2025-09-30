import { requireTHREE } from '../../shared/threeSetup.js';
import { getPlanetMaterial } from './sharedMaterials.js';

const PLANET_ID = 'mars';

/**
 * Metadata describing Mars within the orbital view.
 * - id: Unique identifier for registry lookups.
 * - label: Human readable name displayed in UI.
 * - radius: Relative radius in Earth units (Earth = 1).
 * - orbitDistance: Average orbital distance in astronomical units (AU).
 * - loadThresholds: Distance thresholds (in scene units) for LOD transitions.
 */
export const metadata = Object.freeze({
  id: PLANET_ID,
  label: 'Mars',
  radius: 0.532,
  orbitDistance: 1.52,
  loadThresholds: {
    low: 0,
    medium: 130,
    high: 260,
  },
});

/**
 * Create a lightweight mesh representing Mars for the solar-system view.
 *
 * @param {object} [options]
 * @param {number} [options.segments=28] - Segments used for the sphere geometry.
 * @returns {THREE.Mesh}
 */
export function createOrbitalMesh({ segments = 28 } = {}){
  const THREE = requireTHREE();
  const geometry = new THREE.SphereGeometry(metadata.radius, segments, segments);
  const material = getPlanetMaterial(PLANET_ID, {
    color: 0xb6562d,
    roughness: 0.85,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = metadata.label;
  mesh.userData = { planetId: PLANET_ID };
  return mesh;
}

/**
 * Optional hook describing Mars' surface scene for future high-detail loads.
 * @returns {null}
 */
export function createSurfaceDescriptor(){
  return null;
}

/**
 * Optional async hook to load detailed assets for Mars.
 * @returns {Promise<null>}
 */
export async function loadDetailAssets(){
  return null;
}
