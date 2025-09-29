import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.module.js';
import { InputManager, describeControls } from './InputManager.js';
import { PlaneController, createPlaneMesh } from './PlaneController.js';
import { ChaseCamera } from './ChaseCamera.js';
import { WorldStreamer } from './WorldStreamer.js';
import { CollisionSystem } from './CollisionSystem.js';
import { HUD } from './HUD.js';

const SKY_CEILING = 1800;
const ORIGIN_REBASE_DISTANCE = 1400;
const ORIGIN_REBASE_DISTANCE_SQ = ORIGIN_REBASE_DISTANCE * ORIGIN_REBASE_DISTANCE;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.style.margin = '0';
document.body.style.overflow = 'hidden';
document.body.appendChild(renderer.domElement);

document.body.style.background = 'linear-gradient(180deg, #79a7ff 0%, #cfe5ff 45%, #f6fbff 100%)';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x90b6ff);
scene.fog = new THREE.Fog(0xa4c6ff, 1200, 2800);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 20000);

const hemisphere = new THREE.HemisphereLight(0xdce9ff, 0x2b4a2e, 0.85);
scene.add(hemisphere);

const sun = new THREE.DirectionalLight(0xffffff, 1.05);
sun.position.set(-420, 580, 780);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -800;
sun.shadow.camera.right = 800;
sun.shadow.camera.top = 800;
sun.shadow.camera.bottom = -800;
sun.shadow.camera.far = 2200;
scene.add(sun);

const world = new WorldStreamer({ scene, chunkSize: 640, radius: 2, seed: 982451653 });

const planeMesh = createPlaneMesh();
scene.add(planeMesh);

const planeController = new PlaneController();
planeController.attachMesh(planeMesh);

const input = new InputManager();
const chaseCamera = new ChaseCamera(camera, { distance: 70, height: 26, stiffness: 3.6, lookAhead: 18 });
const hud = new HUD({ controls: describeControls() });
const collisionSystem = new CollisionSystem({ world, crashMargin: 2.2, obstaclePadding: 3 });

const startAnchor = new THREE.Vector3(0, -320, 0);
let crashCount = 0;
let crashCooldown = 0;

function computeStartPosition(){
  const spawn = startAnchor.clone();
  const ground = world.getHeightAt(spawn.x, spawn.y);
  spawn.z = ground + 52;
  return spawn;
}

function resetPlane(){
  const spawn = computeStartPosition();
  planeController.reset({ position: spawn, yaw: 0, pitch: THREE.MathUtils.degToRad(2), throttle: 0.42 });
  chaseCamera.currentPosition.copy(spawn.clone().add(new THREE.Vector3(-40, -60, 30)));
  camera.position.copy(chaseCamera.currentPosition);
  crashCooldown = 0.8;
  world.update(planeController.position);
  chaseCamera.update(planeController.getState(), 0.016);
}

resetPlane();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function clampAltitude(controller, ground){
  if (controller.position.z > SKY_CEILING){
    controller.position.z = SKY_CEILING;
    if (controller.velocity.z > 0) controller.velocity.z = 0;
  }
}

let lastTime = performance.now();

function animate(now){
  requestAnimationFrame(animate);
  const dt = Math.min(0.08, (now - lastTime) / 1000 || 0);
  lastTime = now;

  const inputState = crashCooldown > 0 ? { pitch: 0, yaw: 0, roll: 0, throttleAdjust: 0, brake: false } : input.readState();
  planeController.update(dt, inputState, {
    sampleGroundHeight: (x, y) => world.getHeightAt(x, y),
    clampAltitude,
  });

  const planeState = planeController.getState();

  if (crashCooldown > 0){
    crashCooldown = Math.max(0, crashCooldown - dt);
  }

  if (crashCooldown <= 0){
    const collision = collisionSystem.evaluate(planeState);
    if (collision.crashed){
      crashCount += 1;
      hud.showMessage('Crashed! Restarting…');
      resetPlane();
    }
  }

  rebaseWorldIfNeeded();

  world.update(planeState.position);
  chaseCamera.update(planeState, dt);

  hud.update({
    throttle: planeState.throttle,
    speed: planeState.speed,
    altitude: planeState.altitude ?? 0,
    crashCount,
  });

  renderer.render(scene, camera);
}

function rebaseWorldIfNeeded(){
  const pos = planeController.position;
  const distanceSq = pos.x * pos.x + pos.y * pos.y;
  if (distanceSq > ORIGIN_REBASE_DISTANCE_SQ){
    const shift = new THREE.Vector3(pos.x, pos.y, 0);
    planeController.position.sub(shift);
    planeMesh.position.copy(planeController.position);
    chaseCamera.currentPosition.sub(shift);
    camera.position.sub(shift);
    world.handleOriginShift(shift);
  }
}

requestAnimationFrame(animate);
