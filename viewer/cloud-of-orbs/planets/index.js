import * as sun from './sun.js';
import * as mercury from './mercury.js';
import * as venus from './venus.js';
import * as earth from './earth.js';
import * as mars from './mars.js';
import * as jupiter from './jupiter.js';
import * as saturn from './saturn.js';
import * as uranus from './uranus.js';
import * as neptune from './neptune.js';

const PLANET_MODULES_IN_RENDER_ORDER = [
  sun,
  mercury,
  venus,
  earth,
  mars,
  jupiter,
  saturn,
  uranus,
  neptune,
];

const PLANET_REGISTRY = new Map(
  PLANET_MODULES_IN_RENDER_ORDER.map((module) => [module.metadata.id, module]),
);

/**
 * Immutable list of planet modules ordered for renderer placement (inner to outer).
 */
export const PLANETS_IN_RENDER_ORDER = Object.freeze([...PLANET_MODULES_IN_RENDER_ORDER]);

/**
 * Retrieve a planet module by its identifier.
 *
 * @param {string} id - Planet identifier (e.g. 'earth').
 * @returns {object|null}
 */
export function getPlanetModule(id){
  return PLANET_REGISTRY.get(id) ?? null;
}

/**
 * Retrieve metadata for a planet by identifier.
 *
 * @param {string} id - Planet identifier (e.g. 'mars').
 * @returns {object|null}
 */
export function getPlanetMetadata(id){
  const module = PLANET_REGISTRY.get(id);
  return module ? module.metadata : null;
}

/**
 * Iterate over every registered planet module.
 *
 * @returns {IterableIterator<[string, object]>}
 */
export function entries(){
  return PLANET_REGISTRY.entries();
}

/**
 * Provide direct access to the registry map without exposing mutation helpers.
 *
 * @returns {Map<string, object>}
 */
export function getRegistrySnapshot(){
  return new Map(PLANET_REGISTRY);
}
