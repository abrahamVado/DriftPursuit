import { InputManager, describeControls } from './InputManager.js';
import { PlaneController, createPlaneMesh } from './PlaneController.js';
import { CarController, createCarRig } from './CarController.js';
import { ChaseCamera } from './ChaseCamera.js';
import { WorldStreamer } from './WorldStreamer.js';
import { CollisionSystem } from './CollisionSystem.js';
import { HUD } from './HUD.js';
import {
  createRenderer,
  createPerspectiveCamera,
  enableWindowResizeHandling,
  requireTHREE,
} from '../shared/threeSetup.js';

const THREE = requireTHREE();

const SKY_CEILING = 1800;
const ORIGIN_REBASE_DISTANCE = 1400;
const ORIGIN_REBASE_DISTANCE_SQ = ORIGIN_REBASE_DISTANCE * ORIGIN_REBASE_DISTANCE;

document.body.style.margin = '0';
document.body.style.overflow = 'hidden';
const renderer = createRenderer();

document.body.style.background = 'linear-gradient(180deg, #79a7ff 0%, #cfe5ff 45%, #f6fbff 100%)';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x90b6ff);
scene.fog = new THREE.Fog(0xa4c6ff, 1500, 4200);

const camera = createPerspectiveCamera({ fov: 60, near: 0.1, far: 20000 });

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

const world = new WorldStreamer({ scene, chunkSize: 640, radius: 3, seed: 982451653 });

const planeMesh = createPlaneMesh();
scene.add(planeMesh);

const planeController = new PlaneController();
planeController.attachMesh(planeMesh);

const carRig = createCarRig();
scene.add(carRig.carMesh);
carRig.carMesh.visible = false;

const carController = new CarController();
carController.attachMesh(carRig.carMesh, {
  stickYaw: carRig.stickYaw,
  stickPitch: carRig.stickPitch,
  towerGroup: carRig.towerGroup,
  towerHead: carRig.towerHead,
  wheels: carRig.wheels,
});

const planeCameraConfig = {
  distance: 78,
  height: 24,
  stiffness: 3.8,
  lookStiffness: 7,
  forwardResponsiveness: 5.2,
  pitchInfluence: 0.42,
};

const carCameraConfig = {
  distance: 36,
  height: 12,
  stiffness: 5.6,
  lookStiffness: 7.6,
  forwardResponsiveness: 6.2,
  pitchInfluence: 0.2,
};

const input = new InputManager();
const chaseCamera = new ChaseCamera(camera, planeCameraConfig);
const planeControls = describeControls('plane');
const carControls = describeControls('car');
const hud = new HUD({ controls: planeControls });
hud.setDropHandler(dropVehicleFromDrone);
const collisionSystem = new CollisionSystem({ world, crashMargin: 2.2, obstaclePadding: 3 });
updateDropButtonState();

const startAnchor = new THREE.Vector3(0, -320, 0);
let crashCount = 0;
let crashCooldown = 0;
let elapsedFlightTime = 0;
let traveledDistance = 0;
const lastPlanePosition = new THREE.Vector3();
let elapsedDriveTime = 0;
let drivenDistance = 0;
const lastCarPosition = new THREE.Vector3();
const DRONE_CARGO_OFFSET = new THREE.Vector3(0, -14, -12);
const TMP_EULER = new THREE.Euler();

const VEHICLE_MODES = { PLANE: 'plane', CAR: 'car' };
let activeVehicle = VEHICLE_MODES.PLANE;
let carAttachedToDrone = true;

function computeStartPosition(){
  const spawn = startAnchor.clone();
  const ground = world.getHeightAt(spawn.x, spawn.y);
  spawn.z = ground + 52;
  return spawn;
}

function resetPlane(){
  const spawn = computeStartPosition();
  planeController.reset({ position: spawn, yaw: 0, pitch: THREE.MathUtils.degToRad(2), throttle: 0.42 });
  crashCooldown = 0.8;
  elapsedFlightTime = 0;
  traveledDistance = 0;
  lastPlanePosition.copy(planeController.position);
  world.update(planeController.position);
  focusCameraOnPlane();
  if (carAttachedToDrone){
    resetCar({ attachToDrone: true });
  }
}

function computeCarStartPosition(){
  const spawn = startAnchor.clone().add(new THREE.Vector3(80, -110, 0));
  const ground = world.getHeightAt(spawn.x, spawn.y);
  spawn.z = ground + carController.height;
  return spawn;
}

function extractYaw(quaternion){
  if (!quaternion) return 0;
  TMP_EULER.setFromQuaternion(quaternion, 'ZXY');
  return TMP_EULER.z || 0;
}

function computeDroneHoldPosition(){
  const planeState = planeController.getState();
  const basePosition = planeState?.position
    ? planeState.position.clone()
    : planeController.position.clone();
  basePosition.add(DRONE_CARGO_OFFSET);
  const ground = world.getHeightAt(basePosition.x, basePosition.y);
  if (Number.isFinite(ground)){
    const minZ = ground + carController.height + 4;
    basePosition.z = Math.max(basePosition.z, minZ);
  }
  const yaw = planeState?.orientation ? extractYaw(planeState.orientation) : planeController.yaw ?? 0;
  return { position: basePosition, yaw };
}

function updateDropButtonState(){
  hud.setDropEnabled(carAttachedToDrone && activeVehicle === VEHICLE_MODES.PLANE);
}

function resetCar({ alignCamera = false, attachToDrone = false } = {}){
  const spawn = attachToDrone
    ? computeDroneHoldPosition()
    : { position: computeCarStartPosition(), yaw: 0 };
  carController.reset({ position: spawn.position, yaw: spawn.yaw ?? 0 });
  carController.velocity.set(0, 0, 0);
  carController.speed = 0;
  elapsedDriveTime = 0;
  drivenDistance = 0;
  lastCarPosition.copy(carController.position);
  carAttachedToDrone = attachToDrone;
  if (attachToDrone){
    carRig.carMesh.visible = false;
    if (alignCamera){
      focusCameraOnPlane();
    }
  } else {
    carRig.carMesh.visible = true;
    if (alignCamera){
      focusCameraOnCar();
    }
  }
  updateDropButtonState();
}

function focusCameraOnPlane(){
  chaseCamera.setConfig(planeCameraConfig);
  chaseCamera.resetOrbit();
  chaseCamera.snapTo(planeController.getState());
}

function focusCameraOnCar(){
  chaseCamera.setConfig(carCameraConfig);
  chaseCamera.resetOrbit();
  chaseCamera.snapTo(carController.getState());
}

function dropVehicleFromDrone(){
  if (!carAttachedToDrone) return;
  const hold = computeDroneHoldPosition();
  const dropPosition = hold.position.clone();
  const ground = world.getHeightAt(dropPosition.x, dropPosition.y);
  if (Number.isFinite(ground)){
    const minZ = ground + carController.height + 1.5;
    dropPosition.z = Math.max(dropPosition.z, minZ);
  }
  carController.reset({ position: dropPosition, yaw: hold.yaw ?? 0 });
  carController.velocity.set(0, 0, 0);
  carController.speed = 0;
  carRig.carMesh.visible = true;
  carAttachedToDrone = false;
  updateDropButtonState();
  lastCarPosition.copy(carController.position);
  hud.showMessage('Vehicle deployed!', 900);
  activateCarMode();
}

function activatePlaneMode(){
  activeVehicle = VEHICLE_MODES.PLANE;
  planeMesh.visible = true;
  carRig.carMesh.visible = !carAttachedToDrone;
  hud.setControls(planeControls);
  focusCameraOnPlane();
  updateDropButtonState();
}

function activateCarMode({ focus = true } = {}){
  activeVehicle = VEHICLE_MODES.CAR;
  planeMesh.visible = false;
  carRig.carMesh.visible = true;
  hud.setControls(carControls);
  if (focus){
    focusCameraOnCar();
  }
  updateDropButtonState();
}

resetPlane();
resetCar({ attachToDrone: true });

enableWindowResizeHandling({ renderer, camera });

function clampAltitude(controller, ground){
  if (controller.position.z > SKY_CEILING){
    controller.position.z = SKY_CEILING;
    if (controller.velocity.z > 0) controller.velocity.z = 0;
  }
}

let lastTime = performance.now();

function setActiveVehicle(mode){
  if (mode === activeVehicle) return;
  if (mode === VEHICLE_MODES.PLANE){
    activatePlaneMode();
  } else if (mode === VEHICLE_MODES.CAR){
    if (carAttachedToDrone){
      dropVehicleFromDrone();
      return;
    }
    activateCarMode();
  }
}

window.addEventListener('keydown', (event) => {
  if (event.code === 'Digit1'){
    setActiveVehicle(VEHICLE_MODES.PLANE);
  } else if (event.code === 'Digit2'){
    setActiveVehicle(VEHICLE_MODES.CAR);
  }
});

function animate(now){
  requestAnimationFrame(animate);
  const dt = Math.min(0.08, (now - lastTime) / 1000 || 0);
  lastTime = now;

  const inputSample = input.readState(dt);
  const planeInput = crashCooldown > 0 ? { pitch: 0, yaw: 0, roll: 0, throttleAdjust: 0, brake: false } : inputSample.plane;

  if (crashCooldown > 0){
    crashCooldown = Math.max(0, crashCooldown - dt);
  }

  if (activeVehicle === VEHICLE_MODES.PLANE){
    planeController.update(dt, planeInput, {
      sampleGroundHeight: (x, y) => world.getHeightAt(x, y),
      clampAltitude,
    });

    const planeState = planeController.getState();

    if (crashCooldown <= 0){
      const collision = collisionSystem.evaluate(planeState);
      if (collision.crashed){
        crashCount += 1;
        hud.showMessage('Crashed! Restarting…');
        resetPlane();
      }
    }

    if (crashCooldown <= 0){
      elapsedFlightTime += dt;
      const frameDistance = planeState.position.distanceTo(lastPlanePosition);
      if (Number.isFinite(frameDistance)){
        traveledDistance += frameDistance;
      }
    }
    lastPlanePosition.copy(planeState.position);

    if (carAttachedToDrone){
      const hold = computeDroneHoldPosition();
      carController.position.copy(hold.position);
      carController.yaw = hold.yaw;
      carController.velocity.set(0, 0, 0);
      carController.speed = 0;
      carController._updateOrientation?.();
      if (carRig.carMesh){
        carRig.carMesh.position.copy(carController.position);
        carRig.carMesh.quaternion.copy(carController.orientation);
      }
      lastCarPosition.copy(carController.position);
    }

    rebaseWorldIfNeeded(planeController.position);
    world.update(planeState.position);
    chaseCamera.update(planeState, dt, inputSample.cameraOrbit);

    hud.update({
      throttle: planeState.throttle,
      speed: planeState.speed,
      crashCount,
      elapsedTime: elapsedFlightTime,
      distance: traveledDistance,
    });
  } else {
    carController.update(dt, inputSample.car, {
      sampleGroundHeight: (x, y) => world.getHeightAt(x, y),
    });

    const carState = carController.getState();
    elapsedDriveTime += dt;
    const frameDistance = carState.position.distanceTo(lastCarPosition);
    if (Number.isFinite(frameDistance)){
      drivenDistance += frameDistance;
    }
    lastCarPosition.copy(carState.position);

    rebaseWorldIfNeeded(carController.position);
    world.update(carState.position);
    chaseCamera.update(carState, dt, inputSample.cameraOrbit);

    hud.update({
      throttle: carState.throttle,
      speed: carState.speed,
      crashCount: 0,
      elapsedTime: elapsedDriveTime,
      distance: drivenDistance,
    });
  }

  renderer.render(scene, camera);
}

function rebaseWorldIfNeeded(referencePosition){
  const pos = referencePosition ?? planeController.position;
  const distanceSq = pos.x * pos.x + pos.y * pos.y;
  if (distanceSq > ORIGIN_REBASE_DISTANCE_SQ){
    const shift = new THREE.Vector3(pos.x, pos.y, 0);
    planeController.position.sub(shift);
    planeMesh.position.copy(planeController.position);
    carController.position.sub(shift);
    carRig.carMesh.position.copy(carController.position);
    chaseCamera.currentPosition.sub(shift);
    camera.position.sub(shift);
    lastPlanePosition.sub(shift);
    lastCarPosition.sub(shift);
    world.handleOriginShift(shift);
  }
}

requestAnimationFrame(animate);
