import { requireTHREE } from '../../shared/threeSetup.js';
import { getPlanetMaterial } from './sharedMaterials.js';

const PLANET_ID = 'earth';

/**
 * Metadata describing Earth within the orbital view.
 * - id: Unique identifier for registry lookups.
 * - label: Human readable name displayed in UI.
 * - radius: Relative radius in Earth units (Earth = 1).
 * - orbitDistance: Average orbital distance in astronomical units (AU).
 * - loadThresholds: Distance thresholds (in scene units) for LOD transitions.
 * - angularVelocity: Orbital angular velocity in radians per Earth year.
 * - inclination: Orbital inclination in degrees relative to the ecliptic.
 */
export const metadata = Object.freeze({
  id: PLANET_ID,
  label: 'Earth',
  radius: 1,
  orbitDistance: 1,
  angularVelocity: 6.283185307179586,
  inclination: 0,
  loadThresholds: {
    low: 0,
    medium: 150,
    high: 300,
  },
});

/**
 * Create a lightweight mesh representing Earth for the solar-system view.
 *
 * @param {object} [options]
 * @param {number} [options.segments=32] - Segments used for the sphere geometry.
 * @returns {THREE.Mesh}
 */
export function createOrbitalMesh({ segments = 32 } = {}){
  const THREE = requireTHREE();
  const geometry = new THREE.SphereGeometry(metadata.radius, segments, segments);
  const material = getPlanetMaterial(PLANET_ID, {
    color: 0x2a6bd4,
    roughness: 0.75,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = metadata.label;
  mesh.userData = { planetId: PLANET_ID };
  return mesh;
}

/**
 * Optional hook describing Earth's surface scene for future high-detail loads.
 * @returns {null}
 */
export function createSurfaceDescriptor(){
  return null;
}

/**
 * Optional async hook to load detailed assets for Earth.
 * @returns {Promise<null>}
 */
export async function loadDetailAssets(){
  return null;
}
