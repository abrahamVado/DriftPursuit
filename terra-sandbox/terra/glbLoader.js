import { requireTHREE } from '../shared/threeSetup.js';
import { ensureGlobalGLTFLoader } from './ensureGltfLoader.js';

const loaderCache = new Map();

function normalizeAssetRoot(root){
  if (!root) return '';
  const trimmed = String(root).replace(/\\/g, '/').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)){
    return trimmed.replace(/\/?$/, '/');
  }
  if (trimmed.startsWith('/')){
    return trimmed.replace(/\/?$/, '/');
  }
  return `${trimmed.replace(/\/?$/, '')}/`;
}

function resolveAssetUrl(path, assetRoot){
  if (!path) return null;
  const normalizedPath = String(path).replace(/\\/g, '/').replace(/^\.\//, '');
  if (/^data:/i.test(normalizedPath)){
    return normalizedPath;
  }
  if (/^https?:\/\//i.test(normalizedPath) || normalizedPath.startsWith('/')){
    return normalizedPath;
  }
  const base = normalizeAssetRoot(assetRoot);
  if (!base) return normalizedPath;
  const combined = `${base}${normalizedPath}`;
  return combined.replace(/([^:])\/\/+/g, '$1/');
}

async function getLoader(assetRoot){
  const THREE = requireTHREE();
  const key = normalizeAssetRoot(assetRoot) || '__default__';
  if (loaderCache.has(key)){
    return loaderCache.get(key);
  }
  await ensureGlobalGLTFLoader();
  if (typeof THREE.GLTFLoader !== 'function'){
    throw new Error('THREE.GLTFLoader is unavailable. Ensure the GLTFLoader module is accessible.');
  }
  const loader = new THREE.GLTFLoader();
  loaderCache.set(key, loader);
  return loader;
}

export async function loadGLTFAsset(path, { assetRoot, onProgress, signal } = {}){
  const url = resolveAssetUrl(path, assetRoot);
  if (!url){
    throw new Error('GLTF asset path was not provided');
  }
  const loader = await getLoader(assetRoot);

  return new Promise((resolve, reject) => {
    let aborted = false;
    const handleAbort = () => {
      aborted = true;
      reject(new Error('GLTF load aborted'));
    };

    if (signal){
      if (signal.aborted){
        handleAbort();
        return;
      }
      signal.addEventListener('abort', handleAbort, { once: true });
    }

    loader.load(url, (gltf) => {
      if (signal){
        signal.removeEventListener('abort', handleAbort);
      }
      if (aborted) return;
      resolve(gltf);
    }, onProgress, (err) => {
      if (signal){
        signal.removeEventListener('abort', handleAbort);
      }
      if (aborted) return;
      reject(err);
    });
  });
}

export function clearCachedGltfLoaders(){
  loaderCache.clear();
}

export function resolveGlbAssetUrl(path, assetRoot){
  return resolveAssetUrl(path, assetRoot);
}
