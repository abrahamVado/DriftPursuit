import THREE from './threeProxy.js';

const getGlobalTHREE = () => {
  if (!THREE){
    throw new Error('Three.js module failed to load.');
  }
  return THREE;
};

export function createRenderer({
  antialias = true,
  parentElement = typeof document !== 'undefined' ? document.body : null,
  autoAppend = true,
  pixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
  size = typeof window !== 'undefined'
    ? { width: window.innerWidth, height: window.innerHeight }
    : { width: 1, height: 1 },
  enableShadows = true,
} = {}){
  const THREE = getGlobalTHREE();
  const renderer = new THREE.WebGLRenderer({ antialias });
  renderer.setSize(size.width, size.height);
  renderer.setPixelRatio(pixelRatio);
  if (enableShadows){
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  if (autoAppend && parentElement){
    parentElement.appendChild(renderer.domElement);
  }
  return renderer;
}

export function createPerspectiveCamera({
  fov = 60,
  aspect = typeof window !== 'undefined' ? window.innerWidth / window.innerHeight : 1,
  near = 0.1,
  far = 20000,
} = {}){
  const THREE = getGlobalTHREE();
  return new THREE.PerspectiveCamera(fov, aspect, near, far);
}

export function enableWindowResizeHandling({
  renderer,
  camera,
  getSize = () => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1,
    height: typeof window !== 'undefined' ? window.innerHeight : 1,
  }),
} = {}){
  if (typeof window === 'undefined' || !renderer) return;
  window.addEventListener('resize', () => {
    const size = getSize();
    renderer.setSize(size.width, size.height);
    if (camera){
      camera.aspect = size.width / size.height;
      camera.updateProjectionMatrix();
    }
  });
}

export function requireTHREE(){
  return getGlobalTHREE();
}
