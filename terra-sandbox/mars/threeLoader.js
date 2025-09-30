const CDN_MODULE = 'https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.module.js';

let loadPromise = null;

async function loadThreeModule() {
  if (!loadPromise) {
    loadPromise = (async () => {
      if (typeof window === 'undefined') {
        try {
          const module = await import('three');
          return module?.default ?? module;
        } catch (error) {
          console.warn('[MarsSandbox] Failed to load local three module, falling back to CDN:', error);
        }
      }

      const module = await import(CDN_MODULE);
      return module?.default ?? module;
    })();
  }

  return loadPromise;
}

const THREE = await loadThreeModule();

if (typeof window !== 'undefined') {
  if (!window.THREE) {
    window.THREE = THREE;
  }
} else if (typeof globalThis !== 'undefined' && !globalThis.THREE) {
  globalThis.THREE = THREE;
}

export { THREE };
export default THREE;
