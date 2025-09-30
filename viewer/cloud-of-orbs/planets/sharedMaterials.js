import { requireTHREE } from '../../shared/threeSetup.js';

const materialCache = new Map();

/**
 * Retrieve a shared material for a planet-like body.
 * Materials are cached by identifier so that multiple meshes can reuse
 * the same GPU resources.
 *
 * @param {string} id - Unique identifier for the body (e.g. 'earth').
 * @param {object} [options]
 * @param {number} [options.color=0xffffff] - Diffuse color of the surface.
 * @param {number} [options.emissive=0x000000] - Emissive color for glowing bodies.
 * @param {number} [options.metalness=0] - Metalness value passed to MeshStandardMaterial.
 * @param {number} [options.roughness=1] - Roughness value passed to MeshStandardMaterial.
 * @returns {THREE.MeshStandardMaterial}
 */
export function getPlanetMaterial(id, {
  color = 0xffffff,
  emissive = 0x000000,
  metalness = 0,
  roughness = 1,
} = {}){
  if (materialCache.has(id)){
    return materialCache.get(id);
  }

  const THREE = requireTHREE();
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive,
    metalness,
    roughness,
    flatShading: false,
  });

  materialCache.set(id, material);
  return material;
}

/**
 * Dispose of every cached material. Useful when tearing down the viewer.
 */
export function disposeSharedMaterials(){
  for (const material of materialCache.values()){
    material.dispose();
  }
  materialCache.clear();
}
