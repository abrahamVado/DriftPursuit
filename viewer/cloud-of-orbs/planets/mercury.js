import { requireTHREE } from '../../shared/threeSetup.js';
import { getPlanetMaterial } from './sharedMaterials.js';

const PLANET_ID = 'mercury';

/**
 * Metadata describing Mercury within the orbital view.
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
  label: 'Mercury',
  radius: 0.383,
  orbitDistance: 0.39,
  angularVelocity: 26.087902832713034,
  inclination: 7.0,
  loadThresholds: {
    low: 0,
    medium: 80,
    high: 160,
  },
});

/**
 * Create a lightweight mesh representing Mercury for the solar-system view.
 *
 * @param {object} [options]
 * @param {number} [options.segments=24] - Segments used for the sphere geometry.
 * @returns {THREE.Mesh}
 */
export function createOrbitalMesh({ segments = 24 } = {}){
  const THREE = requireTHREE();
  const geometry = new THREE.SphereGeometry(metadata.radius, segments, segments);
  const material = getPlanetMaterial(PLANET_ID, {
    color: 0x9f8f7f,
    roughness: 0.9,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = metadata.label;
  mesh.userData = { planetId: PLANET_ID };
  return mesh;
}

/**
 * Optional hook describing Mercury's surface scene for future high-detail loads.
 * @returns {null}
 */
export function createSurfaceDescriptor(){
  return null;
}

/**
 * Optional async hook to load detailed assets for Mercury.
 * @returns {Promise<null>}
 */
export async function loadDetailAssets(){
  return null;
}
