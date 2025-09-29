import { WorldStreamer } from '../sandbox/WorldStreamer.js';
import {
  createRenderer,
  createPerspectiveCamera,
  enableWindowResizeHandling,
  requireTHREE,
} from '../shared/threeSetup.js';

const THREE = requireTHREE();

document.body.style.margin = '0';
document.body.style.overflow = 'hidden';
document.body.style.background = 'linear-gradient(180deg, #79a7ff 0%, #cfe5ff 45%, #f6fbff 100%)';

const renderer = createRenderer();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x90b6ff);
scene.fog = new THREE.Fog(0xa4c6ff, 1500, 4200);

const camera = createPerspectiveCamera({ fov: 55, near: 0.1, far: 24000 });

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
sun.shadow.camera.far = 2400;
scene.add(sun);

const world = new WorldStreamer({ scene, chunkSize: 640, radius: 3, seed: 982451653 });

const focusPoint = new THREE.Vector3(0, 0, 0);
const lookTarget = new THREE.Vector3();

camera.position.set(520, -520, 340);
lookTarget.copy(focusPoint);
camera.lookAt(lookTarget);

enableWindowResizeHandling({ renderer, camera });

const TRAVEL_RADIUS = 900;
const ORBIT_RADIUS = 520;
const BASE_HEIGHT = 320;
const HEIGHT_SWAY = 46;
let travelAngle = 0;
let lastTime = performance.now();

function animate(now){
  requestAnimationFrame(animate);
  const dt = Math.min(0.08, (now - lastTime) / 1000 || 0);
  lastTime = now;

  travelAngle += dt * 0.05;

  focusPoint.set(
    Math.cos(travelAngle) * TRAVEL_RADIUS,
    Math.sin(travelAngle) * TRAVEL_RADIUS,
    0,
  );

  const groundHeight = world.getHeightAt(focusPoint.x, focusPoint.y);
  lookTarget.set(focusPoint.x, focusPoint.y, groundHeight + 42);

  const orbitAngle = travelAngle + Math.PI / 3;
  camera.position.set(
    focusPoint.x + Math.cos(orbitAngle) * ORBIT_RADIUS,
    focusPoint.y + Math.sin(orbitAngle) * ORBIT_RADIUS,
    BASE_HEIGHT + Math.sin(travelAngle * 0.6) * HEIGHT_SWAY,
  );
  camera.lookAt(lookTarget);

  world.update(focusPoint);
  renderer.render(scene, camera);
}

world.update(focusPoint);
requestAnimationFrame(animate);
