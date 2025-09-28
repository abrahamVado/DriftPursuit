// viewer/app.js - minimal three.js viewer that connects to ws://localhost:8080/ws
const HUD = document.getElementById('hud');
const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';

const PLANE_STALE_TIMEOUT_MS = 5000;
const MOVEMENT_KEY_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', // planar translation
  'KeyR', 'KeyF',                 // altitude adjustments
  'Space', 'ShiftLeft', 'ShiftRight', // optional vertical control keys
  'KeyQ', 'KeyE',                 // yaw
  'ArrowUp', 'ArrowDown',         // pitch
  'ArrowLeft', 'ArrowRight'       // roll
]);
const TRANSLATION_SPEED = 80; // units per second (scene coordinates)
const ALTITUDE_SPEED = 60;
const ROTATION_SPEED = Math.PI / 3; // radians per second
const MIN_ALTITUDE = 0;
const MAX_ALTITUDE = 400;
const MAX_DISTANCE = 1000;
const MAX_ROLL = Math.PI * 0.75;
const MAX_PITCH = Math.PI * 0.5;

let scene, camera, renderer;
const planeMeshes = new Map();   // id -> THREE.Mesh
const planeLastSeen = new Map(); // id -> timestamp
let currentFollowId = null;
let cakes = {};

const pressedKeys = new Set();
let manualControlEnabled = false;
let manualMovementActive = false;
let connectionStatus = 'Connecting…';
let lastFrameTime = null;

updateHudStatus();

window.addEventListener('keydown', handleKeyDown);
window.addEventListener('keyup', handleKeyUp);

initThree();

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
    let mesh = planeMeshes.get(id);
    if (!mesh){
      const geom = new THREE.BoxGeometry(12,4,4);
      const mat = new THREE.MeshStandardMaterial({color:0x3366ff});
      mesh = new THREE.Mesh(geom, mat);
      planeMeshes.set(id, mesh);
      scene.add(mesh);
      if (!currentFollowId) currentFollowId = id; // follow first seen plane by default
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
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
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
      if (mesh){
        scene.remove(mesh);
        if (mesh.geometry){ mesh.geometry.dispose(); }
        if (mesh.material){
          if (Array.isArray(mesh.material)){
            mesh.material.forEach(m => m.dispose && m.dispose());
          } else if (mesh.material.dispose){
            mesh.material.dispose();
          }
        }
      }
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

  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)){
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

  const appliedDelta = Number.isFinite(delta) ? Math.max(delta, 0) : 0;
  const position = mesh.position;
  let moved = false;

  if (pressedKeys.has('KeyW')){ position.y += TRANSLATION_SPEED * appliedDelta; moved = true; }
  if (pressedKeys.has('KeyS')){ position.y -= TRANSLATION_SPEED * appliedDelta; moved = true; }
  if (pressedKeys.has('KeyA')){ position.x -= TRANSLATION_SPEED * appliedDelta; moved = true; }
  if (pressedKeys.has('KeyD')){ position.x += TRANSLATION_SPEED * appliedDelta; moved = true; }
  if (pressedKeys.has('KeyR') || pressedKeys.has('Space')){ position.z += ALTITUDE_SPEED * appliedDelta; moved = true; }
  if (pressedKeys.has('KeyF') || pressedKeys.has('ShiftLeft') || pressedKeys.has('ShiftRight')){ position.z -= ALTITUDE_SPEED * appliedDelta; moved = true; }

  position.x = clamp(position.x, -MAX_DISTANCE, MAX_DISTANCE);
  position.y = clamp(position.y, -MAX_DISTANCE, MAX_DISTANCE);
  position.z = clamp(position.z, MIN_ALTITUDE, MAX_ALTITUDE);

  const rotation = mesh.rotation;
  let rotated = false;

  if (pressedKeys.has('KeyQ')){ rotation.z += ROTATION_SPEED * appliedDelta; rotated = true; }
  if (pressedKeys.has('KeyE')){ rotation.z -= ROTATION_SPEED * appliedDelta; rotated = true; }
  if (pressedKeys.has('ArrowUp')){ rotation.y += ROTATION_SPEED * appliedDelta; rotated = true; }
  if (pressedKeys.has('ArrowDown')){ rotation.y -= ROTATION_SPEED * appliedDelta; rotated = true; }
  if (pressedKeys.has('ArrowLeft')){ rotation.x += ROTATION_SPEED * appliedDelta; rotated = true; }
  if (pressedKeys.has('ArrowRight')){ rotation.x -= ROTATION_SPEED * appliedDelta; rotated = true; }

  rotation.x = clamp(rotation.x, -MAX_ROLL, MAX_ROLL);
  rotation.y = clamp(rotation.y, -MAX_PITCH, MAX_PITCH);

  if (moved || rotated){
    updateCameraTarget(mesh);
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
  HUD.innerText = `${connectionStatus}\nMode: ${controlMode}\n[M] toggle manual · WASD/RF move · QE yaw · arrows pitch/roll`;
}
