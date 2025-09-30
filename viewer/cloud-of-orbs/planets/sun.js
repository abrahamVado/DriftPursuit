import { requireTHREE } from '../../shared/threeSetup.js';
import { getPlanetMaterial } from './sharedMaterials.js';

const PLANET_ID = 'sun';

/**
 * Metadata describing the Sun within the orbital view.
 * - id: Unique identifier for registry lookups.
 * - label: Human readable name displayed in UI.
 * - radius: Relative radius in Earth units (Earth = 1).
 * - orbitDistance: Average orbital distance in astronomical units (AU).
 * - loadThresholds: Distance thresholds (in scene units) for LOD transitions.
 */
export const metadata = Object.freeze({
  id: PLANET_ID,
  label: 'Sun',
  radius: 109,
  orbitDistance: 0,
  loadThresholds: {
    low: 0,
    medium: 200,
    high: 450,
  },
});

/**
 * Create a lightweight mesh representing the Sun for the solar-system view.
 *
 * @param {object} [options]
 * @param {number} [options.segments=48] - Segments used for the sphere geometry.
 * @returns {THREE.Mesh}
 */
export function createOrbitalMesh({ segments = 48 } = {}){
  const THREE = requireTHREE();
  const geometry = new THREE.SphereGeometry(metadata.radius, segments, segments);
  const material = getPlanetMaterial(PLANET_ID, {
    color: 0xffc857,
    emissive: 0xffa000,
    roughness: 0.6,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = metadata.label;
  mesh.userData = { planetId: PLANET_ID };
  return mesh;
}

/**
 * Optional hook to describe the Sun's surface scene when entering detail mode.
 * Currently returns null until higher fidelity assets are implemented.
 * @returns {null}
 */
export function createSurfaceDescriptor(){
  return null;
}

/**
 * Optional async hook to load detailed assets for the Sun.
 * @returns {Promise<null>}
 */
export async function loadDetailAssets(){
  return null;
}
