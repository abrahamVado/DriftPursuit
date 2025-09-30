import { requireTHREE } from '../../shared/threeSetup.js';
import { getPlanetMaterial } from './sharedMaterials.js';

const PLANET_ID = 'saturn';

/**
 * Metadata describing Saturn within the orbital view.
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
  label: 'Saturn',
  radius: 9.45,
  orbitDistance: 9.58,
  angularVelocity: 0.21336907153129228,
  inclination: 2.5,
  loadThresholds: {
    low: 0,
    medium: 340,
    high: 680,
  },
});

/**
 * Create a lightweight mesh representing Saturn for the solar-system view.
 *
 * @param {object} [options]
 * @param {number} [options.segments=44] - Segments used for the sphere geometry.
 * @returns {THREE.Mesh}
 */
export function createOrbitalMesh({ segments = 44 } = {}){
  const THREE = requireTHREE();
  const geometry = new THREE.SphereGeometry(metadata.radius, segments, segments);
  const material = getPlanetMaterial(PLANET_ID, {
    color: 0xead6a5,
    roughness: 0.82,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = metadata.label;
  mesh.userData = { planetId: PLANET_ID };
  return mesh;
}

/**
 * Optional hook describing Saturn's surface scene for future high-detail loads.
 * @returns {null}
 */
export function createSurfaceDescriptor(){
  return null;
}

/**
 * Optional async hook to load detailed assets for Saturn.
 * @returns {Promise<null>}
 */
export async function loadDetailAssets(){
  return null;
}
