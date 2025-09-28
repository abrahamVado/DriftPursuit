// viewer/app.js - minimal three.js viewer that connects to ws://localhost:8080/ws
const HUD = document.getElementById('hud');
const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';

const PLANE_STALE_TIMEOUT_MS = 5000;

let scene, camera, renderer;
const planeMeshes = new Map();   // id -> THREE.Object3D
const planeLastSeen = new Map(); // id -> timestamp
let currentFollowId = null;
let cakes = {};
const MODEL_PATH = 'assets/models/high_fidelity_aircraft.gltf';
let gltfLoader = null;
let aircraftLoadError = false;
try {
  if (typeof THREE !== 'undefined' && typeof THREE.GLTFLoader === 'function'){
    gltfLoader = new THREE.GLTFLoader();
  } else {
    console.warn('GLTFLoader helper unavailable; falling back to primitive aircraft mesh.');
    aircraftLoadError = true;
  }
} catch (err){
  console.warn('Failed to initialize GLTFLoader; using fallback mesh.', err);
  aircraftLoadError = true;
}
let aircraftTemplate = null;
let aircraftLoadPromise = null;
const pendingTelemetry = [];
const planeResources = new Map();
initThree();
if (gltfLoader) beginAircraftLoad();

let socket = new WebSocket(WS_URL);
socket.addEventListener('open', ()=>{ if (HUD) HUD.innerText = 'Connected to broker'; });
socket.addEventListener('message', (ev)=>{
  try{
    const msg = JSON.parse(ev.data);
    handleMsg(msg);
  }catch(e){ console.warn('bad msg', e); }
});

function handleMsg(msg){
  if (msg.type === 'telemetry'){
    const id = msg.id;
    const p = msg.pos || [0,0,0];

    if (!aircraftTemplate && !aircraftLoadError){
      pendingTelemetry.push(msg);
      beginAircraftLoad();
      return;
    }

    let mesh = planeMeshes.get(id);
    if (!mesh){
      const { object, geometries, materials, textures } = createAircraftInstance();
      mesh = object;
      planeMeshes.set(id, mesh);
      planeResources.set(id, { geometries, materials, textures });
      scene.add(mesh);
      if (!currentFollowId) currentFollowId = id; // follow first seen plane by default
    }
    // update position (map sim coords to scene; z up)
    mesh.position.set(p[0]/2, p[1]/2, p[2]/50);

    // optional orientation: [yaw, pitch, roll]
    const o = msg.ori;
    if (Array.isArray(o) && o.length === 3){
      const [yaw, pitch, roll] = o;
      // Using ZYX order: yaw (Z), pitch (Y), roll (X)
      const euler = new THREE.Euler(roll, pitch, yaw, 'ZYX');
      mesh.setRotationFromEuler(euler);
    }

    planeLastSeen.set(id, performance.now());

    // update camera only if we're following this plane
    if (currentFollowId === id) updateCameraTarget(mesh);

  } else if (msg.type === 'cake_drop'){
    // create simple sphere at landing_pos and remove after a while
    const id = msg.id;
    const lp = msg.landing_pos || msg.pos || [0,0,0];
    const geom = new THREE.SphereGeometry(3,12,12);
    const mat = new THREE.MeshStandardMaterial({color:0xffcc66});
    const s = new THREE.Mesh(geom, mat);
    s.position.set(lp[0]/2, lp[1]/2, lp[2]/50);
    scene.add(s);
    cakes[id] = s;
    setTimeout(()=>{ scene.remove(s); delete cakes[id]; }, 8000);
  }
}

function beginAircraftLoad(){
  if (!gltfLoader){
    aircraftLoadError = true;
    if (pendingTelemetry.length){
      const queued = pendingTelemetry.splice(0, pendingTelemetry.length);
      queued.forEach((queuedMsg) => handleMsg(queuedMsg));
    }
    return null;
  }

  if (aircraftTemplate || aircraftLoadPromise || aircraftLoadError) return aircraftLoadPromise;

  aircraftLoadPromise = new Promise((resolve, reject) => {
    gltfLoader.load(MODEL_PATH, (gltf) => {
      aircraftTemplate = gltf.scene;
      aircraftTemplate.traverse((node) => {
        if (node.isMesh){
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      resolve(aircraftTemplate);
    }, undefined, (err) => {
      reject(err);
    });
  });

  aircraftLoadPromise.then(() => {
    if (pendingTelemetry.length){
      const queued = pendingTelemetry.splice(0, pendingTelemetry.length);
      queued.forEach((queuedMsg) => handleMsg(queuedMsg));
    }
  }).catch((err) => {
    aircraftLoadError = true;
    console.error('Failed to load aircraft model', err);
    if (pendingTelemetry.length){
      const queued = pendingTelemetry.splice(0, pendingTelemetry.length);
      queued.forEach((queuedMsg) => handleMsg(queuedMsg));
    }
  });

  return aircraftLoadPromise;
}

function createAircraftInstance(){
  if (!aircraftTemplate){
    return createFallbackInstance();
  }

  const clone = aircraftTemplate.clone(true);
  const geometries = [];
  const materials = [];
  const textures = [];

  clone.traverse((node) => {
    if (node.isMesh){
      if (node.geometry){
        const clonedGeometry = node.geometry.clone();
        node.geometry = clonedGeometry;
        geometries.push(clonedGeometry);
      }
      if (node.material){
        if (Array.isArray(node.material)){
          node.material = node.material.map((mat) => {
            const clonedMaterial = mat.clone();
            clonedMaterial.metalness = mat.metalness ?? 0.2;
            clonedMaterial.roughness = mat.roughness ?? 0.55;
            materials.push(clonedMaterial);
            captureMaterialTextures(clonedMaterial, textures);
            return clonedMaterial;
          });
        } else {
          const baseMaterial = node.material;
          const clonedMaterial = baseMaterial.clone();
          clonedMaterial.metalness = baseMaterial.metalness ?? 0.2;
          clonedMaterial.roughness = baseMaterial.roughness ?? 0.55;
          node.material = clonedMaterial;
          materials.push(clonedMaterial);
          captureMaterialTextures(clonedMaterial, textures);
        }
      } else {
        const fallbackMaterial = new THREE.MeshStandardMaterial({color:0x355ad6, metalness:0.25, roughness:0.6});
        node.material = fallbackMaterial;
        materials.push(fallbackMaterial);
      }
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });

  clone.scale.set(0.25, 0.25, 0.25);
  clone.name = 'AircraftInstance';

  return { object: clone, geometries, materials, textures };
}

function createFallbackInstance(){
  const geom = new THREE.BoxGeometry(12,4,4);
  const mat = new THREE.MeshStandardMaterial({color:0x3366ff});
  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.scale.set(0.25, 0.25, 0.25);
  mesh.name = 'FallbackAircraft';
  return { object: mesh, geometries: [geom], materials: [mat], textures: [] };
}

function disposePlaneResources(id){
  const resources = planeResources.get(id);
  if (resources){
    if (Array.isArray(resources.geometries)){
      resources.geometries.forEach((geom) => {
        if (geom && geom.dispose){ geom.dispose(); }
      });
    }
    if (Array.isArray(resources.materials)){
      resources.materials.forEach((mat) => {
        if (!mat) return;
        if (Array.isArray(mat)){
          mat.forEach((inner) => inner && inner.dispose && inner.dispose());
        } else if (mat.dispose){
          mat.dispose();
        }
      });
    }
    if (Array.isArray(resources.textures)){
      resources.textures.forEach((tex) => {
        if (tex && typeof tex.dispose === 'function'){
          tex.dispose();
        }
      });
    }
  }
  planeResources.delete(id);
}

function captureMaterialTextures(material, textures){
  if (!material) return;
  const textureKeys = [
    'map',
    'normalMap',
    'metalnessMap',
    'roughnessMap',
    'aoMap',
    'emissiveMap',
    'alphaMap',
    'envMap'
  ];
  textureKeys.forEach((key) => {
    const tex = material[key];
    if (tex){
      const clonedTexture = (typeof tex.clone === 'function') ? tex.clone() : tex;
      material[key] = clonedTexture;
      textures.push(clonedTexture);
    }
  });
}

function initThree(){
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeef3ff);
  camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 10000);
  renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  window.addEventListener('resize', onWindowResize);

  // lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  hemi.position.set(0, 200, 0); scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8); dir.position.set(-100,100,100); scene.add(dir);

  // ground grid
  const grid = new THREE.GridHelper(2000, 40, 0x888888, 0xcccccc);
  grid.rotation.x = Math.PI/2;
  scene.add(grid);

  setInterval(removeStalePlanes, 1000);

  animate();
}

function onWindowResize(){
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function animate(){
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

function removeStalePlanes(){
  const now = performance.now();
  for (const [id, last] of planeLastSeen.entries()){
    if ((now - last) > PLANE_STALE_TIMEOUT_MS){
      const mesh = planeMeshes.get(id);
      if (mesh){
        scene.remove(mesh);
      }
      disposePlaneResources(id);
      planeMeshes.delete(id);
      planeLastSeen.delete(id);
      if (currentFollowId === id){
        currentFollowId = null;
      }
    }
  }

  // if not following anyone, follow the first available
  if (!currentFollowId && planeMeshes.size > 0){
    const firstEntry = planeMeshes.entries().next().value;
    if (firstEntry){
      currentFollowId = firstEntry[0];
      updateCameraTarget(firstEntry[1]);
    }
  }
}

function updateCameraTarget(mesh){
  camera.position.set(mesh.position.x - 40, mesh.position.y + 0, mesh.position.z + 20);
  camera.lookAt(mesh.position);
}
