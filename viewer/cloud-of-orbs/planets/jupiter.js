import { requireTHREE } from '../../shared/threeSetup.js';
import { getPlanetMaterial } from './sharedMaterials.js';

const PLANET_ID = 'jupiter';

/**
 * Metadata describing Jupiter within the orbital view.
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
  label: 'Jupiter',
  radius: 11.21,
  orbitDistance: 5.2,
  angularVelocity: 0.5296627520306093,
  inclination: 1.3,
  loadThresholds: {
    low: 0,
    medium: 320,
    high: 640,
  },
});

/**
 * Create a lightweight mesh representing Jupiter for the solar-system view.
 *
 * @param {object} [options]
 * @param {number} [options.segments=48] - Segments used for the sphere geometry.
 * @returns {THREE.Mesh}
 */
export function createOrbitalMesh({ segments = 48 } = {}){
  const THREE = requireTHREE();
  const geometry = new THREE.SphereGeometry(metadata.radius, segments, segments);
  const material = getPlanetMaterial(PLANET_ID, {
    color: 0xd8b694,
    roughness: 0.8,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = metadata.label;
  mesh.userData = { planetId: PLANET_ID };
  return mesh;
}

/**
 * Optional hook describing Jupiter's surface scene for future high-detail loads.
 * @returns {null}
 */
export function createSurfaceDescriptor(){
  return null;
}

/**
 * Optional async hook to load detailed assets for Jupiter.
 * @returns {Promise<null>}
 */
export async function loadDetailAssets(){
  return null;
}
