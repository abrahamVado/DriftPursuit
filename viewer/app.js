// viewer/app.js - minimal three.js viewer that connects to ws://localhost:8080/ws
const HUD = document.getElementById('hud');
const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';

const PLANE_STALE_TIMEOUT_MS = 5000;
const MOVEMENT_KEY_CODES = new Set([
  'KeyW','KeyA','KeyS','KeyD',      // planar translation
  'KeyR','KeyF',                    // altitude adjustments
  'Space','ShiftLeft','ShiftRight', // optional vertical control keys
  'KeyQ','KeyE',                    // yaw
  'ArrowUp','ArrowDown',            // pitch
  'ArrowLeft','ArrowRight'          // roll
]);
const TRANSLATION_SPEED = 80; // units/sec (scene coords)
const ALTITUDE_SPEED = 60;
const ROTATION_SPEED = Math.PI / 3; // rad/sec
const MIN_ALTITUDE = 0;
const MAX_ALTITUDE = 400;
const MAX_DISTANCE = 1000;
const MAX_ROLL = Math.PI * 0.75;
const MAX_PITCH = Math.PI * 0.5;

let scene, camera, renderer;
const planeMeshes = new Map();   // id -> THREE.Object3D
const planeLastSeen = new Map(); // id -> timestamp
let currentFollowId = null;
let cakes = {};

// ----- Aircraft model (optional GLTF) -----
const MODEL_PATH = 'assets/models/high_fidelity_aircraft.gltf';
let gltfLoader = null;
let aircraftLoadError = false;
try {
  if (typeof THREE !== 'undefined' && typeof THREE.GLTFLoader === 'function') {
    gltfLoader = new THREE.GLTFLoader();
  } else {
    console.warn('GLTFLoader not found; will use fallback mesh.');
    aircraftLoadError = true;
  }
} catch (err) {
  console.warn('Failed to init GLTFLoader; using fallback mesh.', err);
  aircraftLoadError = true;
}
let aircraftTemplate = null;
let aircraftLoadPromise = null;
const pendingTelemetry = [];
const planeResources = new Map();

// ----- Manual control / HUD state -----
const pressedKeys = new Set();
let manualControlEnabled = false;
let manualMovementActive = false;
let connectionStatus = 'Connecting…';
let lastFrameTime = null;

updateHudStatus();

window.addEventListener('keydown', handleKeyDown);
window.addEventListener('keyup', handleKeyUp);

initThree();
if (gltfLoader) beginAircraftLoad();

let socket = new WebSocket(WS_URL);
socket.addEventListener('open', ()=>{ connectionStatus = 'Connected to broker'; updateHudStatus(); });
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
      if (!currentFollowId) currentFollowId = id; // follow first seen plane
    }

    const targetPosition = new THREE.Vector3(p[0]/2, p[1]/2, p[2]/50);

    // optional orientation: [yaw, pitch, roll]
    const o = msg.ori;
    const shouldApplyTelemetry = !(manualControlEnabled && currentFollowId === id);

    if (shouldApplyTelemetry){
      // update position (map sim coords to scene; z up)
      mesh.position.copy(targetPosition);

      if (Array.isArray(o) && o.length === 3){
        const [yaw, pitch, roll] = o;
        // Using ZYX order: yaw (Z), pitch (Y), roll (X)
        const euler = new THREE.Euler(roll, pitch, yaw, 'ZYX');
        mesh.setRotationFromEuler(euler);
      }
    }

    planeLastSeen.set(id, performance.now());

    // update camera only if we're following this plane and telemetry was applied
    if (currentFollowId === id && shouldApplyTelemetry) updateCameraTarget(mesh);

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
    flushPendingTelemetry();
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
    }, undefined, (err) => reject(err));
  });

  aircraftLoadPromise.then(() => {
    flushPendingTelemetry();
  }).catch((err) => {
    aircraftLoadError = true;
    console.error('Failed to load aircraft model', err);
    flushPendingTelemetry();
  });

  return aircraftLoadPromise;
}

function flushPendingTelemetry(){
  if (!pendingTelemetry.length) return;
  const queued = pendingTelemetry.splice(0, pendingTelemetry.length);
  queued.forEach((queuedMsg) => handleMsg(queuedMsg));
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
      resources.geometries.forEach((g) => g?.dispose && g.dispose());
    }
    if (Array.isArray(resources.materials)){
      resources.materials.forEach((m) => {
        if (!m) return;
        if (Array.isArray(m)) m.forEach((mm)=>mm?.dispose && mm.dispose());
        else if (m.dispose) m.dispose();
      });
    }
    if (Array.isArray(resources.textures)){
      resources.textures.forEach((t) => t?.dispose && t.dispose());
    }
  }
  planeResources.delete(id);
}

function captureMaterialTextures(material, textures){
  if (!material) return;
  const keys = ['map','normalMap','metalnessMap','roughnessMap','aoMap','emissiveMap','alphaMap','envMap'];
  keys.forEach((key) => {
    const tex = material[key];
    if (tex){
      const cloned = (typeof tex.clone === 'function') ? tex.clone() : tex;
      material[key] = cloned;
      textures.push(cloned);
    }
  });
}

// ---- Three.js init & loop ----
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

  requestAnimationFrame(animate);
}

function onWindowResize(){
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

function animate(now){
  requestAnimationFrame(animate);
  const delta = (lastFrameTime === null || now === undefined) ? 0 : (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  updateManualControl(delta);
  renderer.render(scene, camera);
}

function removeStalePlanes(){
  const now = performance.now();
  for (const [id, last] of planeLastSeen.entries()){
    if ((now - last) > PLANE_STALE_TIMEOUT_MS){
      const mesh = planeMeshes.get(id);
      if (mesh) scene.remove(mesh);
      disposePlaneResources(id);
      planeMeshes.delete(id);
      planeLastSeen.delete(id);
      if (currentFollowId === id) currentFollowId = null;
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

// ---- Manual control (viewer-side only; sim is still source of truth when telemetry is applied) ----
function handleKeyDown(event){
  const { code } = event;

  if (code === 'KeyM'){
    manualControlEnabled = !manualControlEnabled;
    if (!manualControlEnabled){
      pressedKeys.clear();
      setManualMovementActive(false);
    }
    updateHudStatus();
    return;
  }

  if (!MOVEMENT_KEY_CODES.has(code)) return;

  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(code)){
    event.preventDefault();
  }

  pressedKeys.add(code);
  if (manualControlEnabled) setManualMovementActive(true);
}

function handleKeyUp(event){
  const { code } = event;
  if (!MOVEMENT_KEY_CODES.has(code)) return;

  pressedKeys.delete(code);
  if (manualControlEnabled && !isAnyMovementKeyActive()){
    setManualMovementActive(false);
  }
}

function isAnyMovementKeyActive(){
  for (const code of MOVEMENT_KEY_CODES){
    if (pressedKeys.has(code)) return true;
  }
  return false;
}

function setManualMovementActive(active){
  if (manualMovementActive === active) return;
  manualMovementActive = active;
  updateHudStatus();
}

function updateManualControl(delta){
  if (!manualControlEnabled) return;
  const mesh = planeMeshes.get(currentFollowId);
  const movementActive = isAnyMovementKeyActive();
  setManualMovementActive(movementActive);

  if (!mesh || !movementActive) return;

  const d = Number.isFinite(delta) ? Math.max(delta, 0) : 0;
  const pos = mesh.position;
  let moved = false;

  if (pressedKeys.has('KeyW')){ pos.y += TRANSLATION_SPEED * d; moved = true; }
  if (pressedKeys.has('KeyS')){ pos.y -= TRANSLATION_SPEED * d; moved = true; }
  if (pressedKeys.has('KeyA')){ pos.x -= TRANSLATION_SPEED * d; moved = true; }
  if (pressedKeys.has('KeyD')){ pos.x += TRANSLATION_SPEED * d; moved = true; }
  if (pressedKeys.has('KeyR') || pressedKeys.has('Space')){ pos.z += ALTITUDE_SPEED * d; moved = true; }
  if (pressedKeys.has('KeyF') || pressedKeys.has('ShiftLeft') || pressedKeys.has('ShiftRight')){ pos.z -= ALTITUDE_SPEED * d; moved = true; }

  pos.x = clamp(pos.x, -MAX_DISTANCE, MAX_DISTANCE);
  pos.y = clamp(pos.y, -MAX_DISTANCE, MAX_DISTANCE);
  pos.z = clamp(pos.z, MIN_ALTITUDE, MAX_ALTITUDE);

  const rot = mesh.rotation;
  let rotated = false;

  if (pressedKeys.has('KeyQ')){ rot.z += ROTATION_SPEED * d; rotated = true; }
  if (pressedKeys.has('KeyE')){ rot.z -= ROTATION_SPEED * d; rotated = true; }
  if (pressedKeys.has('ArrowUp')){ rot.y += ROTATION_SPEED * d; rotated = true; }
  if (pressedKeys.has('ArrowDown')){ rot.y -= ROTATION_SPEED * d; rotated = true; }
  if (pressedKeys.has('ArrowLeft')){ rot.x += ROTATION_SPEED * d; rotated = true; }
  if (pressedKeys.has('ArrowRight')){ rot.x -= ROTATION_SPEED * d; rotated = true; }

  rot.x = clamp(rot.x, -MAX_ROLL, MAX_ROLL);
  rot.y = clamp(rot.y, -MAX_PITCH, MAX_PITCH);

  if (moved || rotated) updateCameraTarget(mesh);
}

function clamp(value, min, max){
  return Math.min(Math.max(value, min), max);
}

function updateHudStatus(){
  if (!HUD) return;
  const controlMode = manualControlEnabled
    ? `Manual ${manualMovementActive ? '(active)' : '(idle)'}`
    : 'Telemetry';
  HUD.innerText = `${connectionStatus}\nMode: ${controlMode}\n[M] toggle manual · WASD/RF move · QE yaw · arrows pitch/roll`;
}
