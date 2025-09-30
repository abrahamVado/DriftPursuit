import { requireTHREE } from '../../shared/threeSetup.js';
import { getPlanetMaterial } from './sharedMaterials.js';

const PLANET_ID = 'neptune';

/**
 * Metadata describing Neptune within the orbital view.
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
  label: 'Neptune',
  radius: 3.88,
  orbitDistance: 30.05,
  angularVelocity: 0.03812813264181381,
  inclination: 1.8,
  loadThresholds: {
    low: 0,
    medium: 300,
    high: 600,
  },
});

/**
 * Create a lightweight mesh representing Neptune for the solar-system view.
 *
 * @param {object} [options]
 * @param {number} [options.segments=36] - Segments used for the sphere geometry.
 * @returns {THREE.Mesh}
 */
export function createOrbitalMesh({ segments = 36 } = {}){
  const THREE = requireTHREE();
  const geometry = new THREE.SphereGeometry(metadata.radius, segments, segments);
  const material = getPlanetMaterial(PLANET_ID, {
    color: 0x3553ff,
    roughness: 0.72,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = metadata.label;
  mesh.userData = { planetId: PLANET_ID };
  return mesh;
}

/**
 * Optional hook describing Neptune's surface scene for future high-detail loads.
 * @returns {null}
 */
export function createSurfaceDescriptor(){
  return null;
}

/**
 * Optional async hook to load detailed assets for Neptune.
 * @returns {Promise<null>}
 */
export async function loadDetailAssets(){
  return null;
}
