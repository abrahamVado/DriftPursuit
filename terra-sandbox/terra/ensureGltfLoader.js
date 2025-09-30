import { requireTHREE } from '../shared/threeSetup.js';

const GLTF_LOADER_MODULE = 'https://cdn.jsdelivr.net/npm/three@0.152.2/examples/jsm/loaders/GLTFLoader.js';
let loaderPromise = null;

function attachLoaderToGlobal(GLTFLoader){
  const THREE = requireTHREE();
  if (typeof GLTFLoader === 'function' && typeof THREE.GLTFLoader !== 'function'){
    THREE.GLTFLoader = GLTFLoader;
  }
  return THREE.GLTFLoader;
}

export async function ensureGlobalGLTFLoader(){
  const THREE = requireTHREE();
  if (typeof THREE.GLTFLoader === 'function'){
    return THREE.GLTFLoader;
  }
  if (!loaderPromise){
    loaderPromise = import(GLTF_LOADER_MODULE)
      .then((module) => {
        const Loader = module?.GLTFLoader ?? module?.default ?? null;
        if (typeof Loader !== 'function'){
          throw new Error('Failed to load GLTFLoader module.');
        }
        return attachLoaderToGlobal(Loader);
      })
      .catch((error) => {
        loaderPromise = null;
        throw error;
      });
  }
  return loaderPromise;
}

export function preloadGLTFLoader(){
  return ensureGlobalGLTFLoader();
}
