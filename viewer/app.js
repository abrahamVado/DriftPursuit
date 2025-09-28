// viewer/app.js - minimal three.js viewer that connects to ws://localhost:8080/ws
const HUD = document.getElementById('hud');
const MANUAL_BUTTON = document.getElementById('manual-toggle');
const ACCELERATE_BUTTON = document.getElementById('accelerate-forward');
const CONTROL_INSTRUCTIONS_LIST = document.getElementById('control-instructions');
const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';

const PLANE_STALE_TIMEOUT_MS = 5000;
const MODEL_SETS = {
  high_fidelity: {
    label: 'High fidelity glTF',
    type: 'gltf',
    path: 'assets/models/high_fidelity_aircraft.gltf',
  },
  stylized_lowpoly: {
    label: 'Stylized low-poly kit',
    type: 'procedural',
    builder: createStylizedLowpolyTemplate,
  },
};
const DEFAULT_MODEL_SET_KEY = 'high_fidelity';
const SELECTED_MODEL_SET_KEY = resolveModelSetKey();
const SELECTED_MODEL_SET = MODEL_SETS[SELECTED_MODEL_SET_KEY] || MODEL_SETS[DEFAULT_MODEL_SET_KEY];
const MODEL_SET_LABEL = SELECTED_MODEL_SET.label;
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
const ACCELERATION_RATE = 90; // units/sec^2 for forward thrust button
const MAX_FORWARD_SPEED = 260; // max forward velocity when thrust engaged
const NATURAL_DECEL = 35; // drag applied when thrust released
const DEFAULT_CONTROL_DOCS = [
  {
    id: 'manual-toggle',
    label: 'Manual Control',
    description: 'Engage viewer-driven control. Keyboard shortcut: press M.'
  },
  {
    id: 'accelerate-forward',
    label: 'Forward Acceleration',
    description: 'Toggle gradual thrust down the runway. Keyboard shortcut: press T.'
  },
  {
    id: 'keyboard',
    label: 'Flight Keys',
    description: 'Use WASD to strafe, RF/Space/Shift to climb or descend, QE for yaw, and arrow keys for pitch/roll.'
  }
];

let scene, camera, renderer;
const planeMeshes = new Map();   // id -> THREE.Object3D
const planeLastSeen = new Map(); // id -> timestamp
let currentFollowId = null;
let cakes = {};

// ----- Aircraft model (optional GLTF or procedural set) -----
let gltfLoader = null;
let aircraftLoadError = false;
if (SELECTED_MODEL_SET.type === 'gltf') {
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
let accelerationEngaged = false;
let forwardSpeed = 0;

updateHudStatus();
wireButtonHandlers();
loadControlDocs();

window.addEventListener('keydown', handleKeyDown);
window.addEventListener('keyup', handleKeyUp);

initThree();
if (SELECTED_MODEL_SET.type === 'procedural' || gltfLoader) beginAircraftLoad();

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
  if (aircraftTemplate || aircraftLoadPromise || aircraftLoadError) return aircraftLoadPromise;

  if (SELECTED_MODEL_SET.type === 'gltf') {
    if (!gltfLoader){
      aircraftLoadError = true;
      flushPendingTelemetry();
      return null;
    }
    aircraftLoadPromise = new Promise((resolve, reject) => {
      gltfLoader.load(SELECTED_MODEL_SET.path, (gltf) => {
        aircraftTemplate = prepareAircraftTemplate(gltf.scene);
        resolve(aircraftTemplate);
      }, undefined, (err) => reject(err));
    });
  } else if (SELECTED_MODEL_SET.type === 'procedural') {
    aircraftLoadPromise = new Promise((resolve, reject) => {
      try {
        aircraftTemplate = prepareAircraftTemplate(SELECTED_MODEL_SET.builder());
        resolve(aircraftTemplate);
      } catch (builderErr) {
        reject(builderErr);
      }
    });
  } else {
    aircraftLoadError = true;
    flushPendingTelemetry();
    return null;
  }

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

function prepareAircraftTemplate(root){
  if (!root) throw new Error('Invalid aircraft template root');
  root.traverse?.((node) => {
    if (node.isMesh){
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  return root;
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
  const group = new THREE.Group();
  const geometries = [];
  const materials = [];

  const CapsuleCtor = typeof THREE.CapsuleGeometry === 'function' ? THREE.CapsuleGeometry : null;
  const fuselageGeometry = CapsuleCtor
    ? new CapsuleCtor(3, 16, 8, 16)
    : new THREE.CylinderGeometry(3.2, 3.2, 22, 16);
  const fuselageMaterial = new THREE.MeshStandardMaterial({ color: 0x3a60f4, metalness: 0.35, roughness: 0.45 });
  const fuselage = new THREE.Mesh(fuselageGeometry, fuselageMaterial);
  fuselage.rotation.z = Math.PI / 2;
  fuselage.castShadow = true;
  fuselage.receiveShadow = true;
  group.add(fuselage);
  geometries.push(fuselageGeometry);
  materials.push(fuselageMaterial);

  const canopyGeometry = new THREE.CylinderGeometry(2.4, 1.6, 6, 16);
  const canopyMaterial = new THREE.MeshStandardMaterial({ color: 0x7fbef5, transparent: true, opacity: 0.7, metalness: 0.2, roughness: 0.1 });
  const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
  canopy.rotation.z = Math.PI / 2;
  canopy.position.set(3, 0, 1.2);
  canopy.castShadow = true;
  group.add(canopy);
  geometries.push(canopyGeometry);
  materials.push(canopyMaterial);

  const wingMaterial = new THREE.MeshStandardMaterial({ color: 0xf2cf63, roughness: 0.55, metalness: 0.12 });
  const mainWingGeometry = new THREE.BoxGeometry(20, 2, 0.8);
  const mainWing = new THREE.Mesh(mainWingGeometry, wingMaterial);
  mainWing.position.set(0, 0, -0.6);
  mainWing.castShadow = true;
  mainWing.receiveShadow = true;
  group.add(mainWing);
  geometries.push(mainWingGeometry);
  materials.push(wingMaterial);

  const tailWingGeometry = new THREE.BoxGeometry(8, 1.8, 0.5);
  const tailWing = new THREE.Mesh(tailWingGeometry, wingMaterial);
  tailWing.position.set(-6.5, 0, -0.2);
  tailWing.castShadow = true;
  tailWing.receiveShadow = true;
  group.add(tailWing);
  geometries.push(tailWingGeometry);

  const verticalStabGeometry = new THREE.BoxGeometry(0.8, 2.6, 3.2);
  const verticalStabMaterial = new THREE.MeshStandardMaterial({ color: 0xff8e4d, roughness: 0.5, metalness: 0.1 });
  const verticalStab = new THREE.Mesh(verticalStabGeometry, verticalStabMaterial);
  verticalStab.position.set(-7.2, 0, 2.0);
  verticalStab.castShadow = true;
  verticalStab.receiveShadow = true;
  group.add(verticalStab);
  geometries.push(verticalStabGeometry);
  materials.push(verticalStabMaterial);

  const propellerGeometry = new THREE.BoxGeometry(0.6, 12, 0.4);
  const propellerMaterial = new THREE.MeshStandardMaterial({ color: 0x1f1f1f, roughness: 0.4, metalness: 0.3 });
  const propeller = new THREE.Mesh(propellerGeometry, propellerMaterial);
  propeller.position.set(11.5, 0, 0);
  propeller.castShadow = true;
  group.add(propeller);
  geometries.push(propellerGeometry);
  materials.push(propellerMaterial);

  group.scale.set(0.25, 0.25, 0.25);
  group.name = 'FallbackAircraft';

  group.traverse((node) => {
    if (node.isMesh){
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });

  return { object: group, geometries, materials, textures: [] };
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

function buildEnvironment(targetScene){
  // Procedural environment intentionally lightweight so it renders smoothly
  // while still providing parallax cues (buildings, trees, runway lines).
  const environment = new THREE.Group();
  environment.name = 'ProceduralEnvironment';

  // Primary grass field.
  const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x7ac87f, roughness: 0.85, metalness: 0.05 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4200, 4200, 1, 1), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  environment.add(ground);

  // Runway strip to emphasize forward motion.
  const runwayMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.7 });
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(1400, 180, 1, 1), runwayMaterial);
  runway.rotation.x = -Math.PI / 2;
  runway.position.set(0, 0, 0.2);
  runway.receiveShadow = true;
  environment.add(runway);

  // Center line markers on the runway.
  const markerMaterial = new THREE.MeshStandardMaterial({ color: 0xf7f7f7, roughness: 0.3 });
  for (let i = -6; i <= 6; i++){
    const marker = new THREE.Mesh(new THREE.PlaneGeometry(50, 6), markerMaterial);
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(i * 110, 0, 0.25);
    marker.receiveShadow = true;
    environment.add(marker);
  }

  // Sidewalk / taxiway stripes.
  const shoulderMaterial = new THREE.MeshStandardMaterial({ color: 0x515865, roughness: 0.6 });
  ['left', 'right'].forEach((side) => {
    const offset = side === 'left' ? -110 : 110;
    const shoulder = new THREE.Mesh(new THREE.PlaneGeometry(1400, 20), shoulderMaterial);
    shoulder.rotation.x = -Math.PI / 2;
    shoulder.position.set(0, offset, 0.22);
    shoulder.receiveShadow = true;
    environment.add(shoulder);
  });

  // Populate the outskirts with a blend of buildings and trees.
  const blockSpacing = 260;
  const blockRows = 3;
  const blockCols = 4;
  const structures = new THREE.Group();
  structures.name = 'Structures';

  for (let row = -blockRows; row <= blockRows; row++){
    for (let col = -blockCols; col <= blockCols; col++){
      if (Math.abs(row) <= 1 && Math.abs(col) <= 1) continue; // keep runway surroundings open
      const worldX = col * blockSpacing;
      const worldY = row * blockSpacing;
      if ((row + col) % 2 === 0){
        structures.add(createBuilding(worldX, worldY));
      } else {
        structures.add(createTree(worldX, worldY));
      }
    }
  }

  environment.add(structures);

  targetScene.add(environment);
}

function createBuilding(x, y){
  const buildingGroup = new THREE.Group();
  buildingGroup.position.set(x, y, 0);

  const baseHeight = 30 + Math.random() * 40;
  const palette = [0xb1c6ff, 0xd6e4ff, 0xf2bb66, 0x9fc0a8, 0xf7d6c1];
  const wallMaterial = new THREE.MeshStandardMaterial({ color: palette[Math.floor(Math.random() * palette.length)], roughness: 0.65, metalness: 0.1 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(60, 60, baseHeight), wallMaterial);
  base.position.set(0, 0, baseHeight / 2);
  base.castShadow = true;
  base.receiveShadow = true;
  buildingGroup.add(base);

  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x36393f, roughness: 0.5, metalness: 0.2 });
  const roof = new THREE.Mesh(new THREE.ConeGeometry(32, 18, 4), roofMaterial);
  roof.rotation.y = Math.PI / 4;
  roof.position.set(0, 0, baseHeight + 9);
  roof.castShadow = true;
  buildingGroup.add(roof);

  return buildingGroup;
}

function createTree(x, y){
  const tree = new THREE.Group();
  tree.position.set(x + (Math.random() * 30 - 15), y + (Math.random() * 30 - 15), 0);

  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x8c5a2b, roughness: 0.8 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 20, 8), trunkMaterial);
  trunk.position.set(0, 0, 10);
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  tree.add(trunk);

  const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0x2f7d32, roughness: 0.6 });
  const foliage = new THREE.Mesh(new THREE.ConeGeometry(20, 40, 10), foliageMaterial);
  foliage.position.set(0, 0, 35);
  foliage.castShadow = true;
  tree.add(foliage);

  return tree;
}

// ---- Three.js init & loop ----
function initThree(){
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfd3ff);
  camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 10000);
  renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  window.addEventListener('resize', onWindowResize);

  // Layered light rig: hemisphere for ambient mood and a sun-style directional light.
  const hemi = new THREE.HemisphereLight(0xe4f1ff, 0x3a5d2f, 0.8);
  hemi.position.set(0, 200, 0);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 0.85);
  dir.position.set(-180, 220, 260);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.camera.left = -400;
  dir.shadow.camera.right = 400;
  dir.shadow.camera.top = 400;
  dir.shadow.camera.bottom = -400;
  dir.shadow.camera.far = 1200;
  scene.add(dir);

  buildEnvironment(scene);

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
function setManualControlEnabled(enabled){
  const shouldEnable = Boolean(enabled);
  if (manualControlEnabled === shouldEnable) return;
  manualControlEnabled = shouldEnable;

  if (!manualControlEnabled){
    pressedKeys.clear();
    setManualMovementActive(false);
    // Disable thrust quietly while avoiding recursive manual re-enabling.
    setAccelerationEngaged(false, { skipManualEnforce: true });
  }

  updateManualButtonState();
  updateHudStatus();
}

function setAccelerationEngaged(enabled, options = {}){
  const shouldEnable = Boolean(enabled);
  if (accelerationEngaged === shouldEnable) return;

  if (shouldEnable && !manualControlEnabled && !options.skipManualEnforce){
    setManualControlEnabled(true);
    if (!manualControlEnabled) return;
  }

  accelerationEngaged = shouldEnable;
  if (!shouldEnable){
    forwardSpeed = 0;
  }

  updateAccelerationButtonState();
  updateHudStatus();
}

function handleKeyDown(event){
  const { code } = event;

  if (code === 'KeyM'){
    setManualControlEnabled(!manualControlEnabled);
    return;
  }

  if (code === 'KeyT'){
    setAccelerationEngaged(!accelerationEngaged);
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
  const movementActive = isAnyMovementKeyActive() || (accelerationEngaged && forwardSpeed > 0.1);
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

  if (accelerationEngaged){
    forwardSpeed = clamp(forwardSpeed + ACCELERATION_RATE * d, 0, MAX_FORWARD_SPEED);
  } else {
    forwardSpeed = Math.max(0, forwardSpeed - NATURAL_DECEL * d);
  }

  if (forwardSpeed > 0){
    pos.y += forwardSpeed * d;
    moved = true;
  }

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

  if (accelerationEngaged || forwardSpeed > 0.1){
    updateHudStatus();
  }
}

function clamp(value, min, max){
  return Math.min(Math.max(value, min), max);
}

function updateHudStatus(){
  if (!HUD) return;
  const controlMode = manualControlEnabled
    ? `Manual ${manualMovementActive ? '(active)' : '(idle)'}`
    : 'Telemetry';
  const accelLabel = accelerationEngaged
    ? `Forward acceleration: ON (${forwardSpeed.toFixed(0)} u/s)`
    : 'Forward acceleration: off';
  HUD.innerText = `${connectionStatus}\nMode: ${controlMode}\nModel set: ${MODEL_SET_LABEL}\n${accelLabel}\n[M] toggle manual · [T] toggle thrust · WASD/RF move · QE yaw · arrows pitch/roll`;
}

function wireButtonHandlers(){
  // Bind UI buttons to the same logic used by the keyboard shortcuts so the
  // behaviour is always synchronized no matter how the pilot interacts.
  if (MANUAL_BUTTON){
    MANUAL_BUTTON.addEventListener('click', () => {
      setManualControlEnabled(!manualControlEnabled);
    });
  }

  if (ACCELERATE_BUTTON){
    ACCELERATE_BUTTON.addEventListener('click', () => {
      setAccelerationEngaged(!accelerationEngaged);
    });
  }

  updateManualButtonState();
  updateAccelerationButtonState();
}

function loadControlDocs(){
  if (!CONTROL_INSTRUCTIONS_LIST) return;

  // Attempt to fetch descriptive metadata from the Go broker; fall back to
  // the static defaults if the endpoint is unavailable (e.g. when served
  // from a static file system or older broker build).
  fetch('/api/controls', { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`Unexpected status ${response.status}`);
      return response.json();
    })
    .then((docs) => renderControlDocs(Array.isArray(docs) ? docs : DEFAULT_CONTROL_DOCS))
    .catch(() => renderControlDocs(DEFAULT_CONTROL_DOCS));
}

function renderControlDocs(docs){
  if (!CONTROL_INSTRUCTIONS_LIST) return;
  CONTROL_INSTRUCTIONS_LIST.innerHTML = '';
  docs.forEach((doc) => {
    const li = document.createElement('li');
    li.textContent = `${doc.label}: ${doc.description}`;
    CONTROL_INSTRUCTIONS_LIST.appendChild(li);
  });
}

function updateManualButtonState(){
  if (!MANUAL_BUTTON) return;
  MANUAL_BUTTON.textContent = manualControlEnabled ? 'Disable Manual Control' : 'Enable Manual Control';
  MANUAL_BUTTON.classList.toggle('is-active', manualControlEnabled);
}

function updateAccelerationButtonState(){
  if (!ACCELERATE_BUTTON) return;
  const label = accelerationEngaged ? 'Stop Forward Acceleration' : 'Start Forward Acceleration';
  ACCELERATE_BUTTON.textContent = label;
  ACCELERATE_BUTTON.classList.toggle('is-active', accelerationEngaged);
}

function resolveModelSetKey(){
  try {
    const params = new URLSearchParams(window.location.search);
    const key = params.get('modelSet') || params.get('modelset');
    if (key && MODEL_SETS[key]) return key;
  } catch (err) {
    console.warn('Unable to parse modelSet parameter', err);
  }
  return DEFAULT_MODEL_SET_KEY;
}

function createStylizedLowpolyTemplate(){
  const group = new THREE.Group();

  const fuselageMaterial = new THREE.MeshStandardMaterial({ color: 0x314e92, metalness: 0.15, roughness: 0.55 });
  const CapsuleCtor = typeof THREE.CapsuleGeometry === 'function' ? THREE.CapsuleGeometry : null;
  const fuselageGeometry = CapsuleCtor
    ? new CapsuleCtor(4, 14, 6, 12)
    : new THREE.CylinderGeometry(4, 4, 18, 12, 1, false);
  const fuselage = new THREE.Mesh(fuselageGeometry, fuselageMaterial);
  fuselage.rotation.z = Math.PI / 2;
  group.add(fuselage);

  const wingMaterial = new THREE.MeshStandardMaterial({ color: 0xffc857, metalness: 0.1, roughness: 0.5 });
  const mainWing = new THREE.Mesh(new THREE.BoxGeometry(18, 2, 0.6), wingMaterial);
  mainWing.position.set(0, 0, 0);
  group.add(mainWing);

  const tailWing = new THREE.Mesh(new THREE.BoxGeometry(6, 1.4, 0.4), wingMaterial);
  tailWing.position.set(-5.5, 0, 1.6);
  group.add(tailWing);

  const verticalStabMaterial = new THREE.MeshStandardMaterial({ color: 0xff8c42, metalness: 0.1, roughness: 0.5 });
  const verticalStab = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.2, 2.6), verticalStabMaterial);
  verticalStab.position.set(-6.0, 0, 2.6);
  group.add(verticalStab);

  const canopyMaterial = new THREE.MeshStandardMaterial({ color: 0x7fb7f3, metalness: 0.4, roughness: 0.2, transparent: true, opacity: 0.8 });
  const canopy = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 1.2, 3.6, 12), canopyMaterial);
  canopy.rotation.z = Math.PI / 2;
  canopy.position.set(1.0, 0, 1.6);
  group.add(canopy);

  group.scale.set(0.25, 0.25, 0.25);
  group.name = 'StylizedLowpolyAircraft';
  return group;
}
