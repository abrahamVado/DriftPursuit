import { InputManager, describeControls } from './InputManager.js';
import { PlaneController, createPlaneMesh } from './PlaneController.js';
import { CarController, createCarRig } from './CarController.js';
import { ChaseCamera } from './ChaseCamera.js';
import { WorldStreamer } from './WorldStreamer.js';
import { CollisionSystem } from './CollisionSystem.js';
import { HUD } from './HUD.js';
import { SpaceScene } from './SpaceScene.js';
import { ProjectileSystem } from './ProjectileSystem.js';
import {
  createRenderer,
  createPerspectiveCamera,
  enableWindowResizeHandling,
  requireTHREE,
} from '../shared/threeSetup.js';

const THREE = requireTHREE();

const SCENARIOS = { PLANET: 'planet', SPACE: 'space' };
const SKY_CEILING = 1800;
const SPACE_CEILING = 22000;
const SPACE_TRANSITION_ALTITUDE = 5000;
const SPACE_RETURN_ALTITUDE = 4400;
const ORIGIN_REBASE_DISTANCE = 1400;
const ORIGIN_REBASE_DISTANCE_SQ = ORIGIN_REBASE_DISTANCE * ORIGIN_REBASE_DISTANCE;

const PLANET_BACKGROUND = new THREE.Color(0x90b6ff);
const SPACE_BACKGROUND = new THREE.Color(0x050913);
const planetFog = new THREE.Fog(0xa4c6ff, 1500, 4200);
const PLANET_BODY_BACKGROUND = 'linear-gradient(180deg, #79a7ff 0%, #cfe5ff 45%, #f6fbff 100%)';
const SPACE_BODY_BACKGROUND = 'radial-gradient(140deg, #020512 0%, #050c18 46%, #000000 100%)';

document.body.style.margin = '0';
document.body.style.overflow = 'hidden';
document.body.style.background = PLANET_BODY_BACKGROUND;
const renderer = createRenderer();

const scene = new THREE.Scene();
scene.background = PLANET_BACKGROUND.clone();
scene.fog = planetFog;

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
const BASE_HEMISPHERE_INTENSITY = hemisphere.intensity;
const BASE_SUN_INTENSITY = sun.intensity;

const spaceScene = new SpaceScene({ scene, seed: 1836311903 });
spaceScene.setVisible(false);

const world = new WorldStreamer({ scene, chunkSize: 640, radius: 3, seed: 982451653 });

const planeMesh = createPlaneMesh();
scene.add(planeMesh);

const planeController = new PlaneController();
planeController.attachMesh(planeMesh);
planeController.setAuxiliaryLightsActive(false);
const BASE_PLANE_GRAVITY = planeController.gravity;
const BASE_PROPULSOR_LIFT = planeController.propulsorLift;

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
const projectileSystem = new ProjectileSystem({ scene, world });
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
let activeScenario = SCENARIOS.PLANET;
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

function applyPlanetEnvironment(){
  document.body.style.background = PLANET_BODY_BACKGROUND;
  if (!scene.background || !scene.background.isColor){
    scene.background = PLANET_BACKGROUND.clone();
  } else {
    scene.background.copy(PLANET_BACKGROUND);
  }
  scene.fog = planetFog;
  hemisphere.intensity = BASE_HEMISPHERE_INTENSITY;
  sun.intensity = BASE_SUN_INTENSITY;
  sun.visible = true;
  world.worldGroup.visible = true;
  if (world._ocean) world._ocean.visible = true;
  spaceScene.setVisible(false);
  planeController.setAuxiliaryLightsActive(false);
  planeController.gravity = BASE_PLANE_GRAVITY;
  planeController.propulsorLift = BASE_PROPULSOR_LIFT;
}

function applySpaceEnvironment(){
  document.body.style.background = SPACE_BODY_BACKGROUND;
  if (!scene.background || !scene.background.isColor){
    scene.background = SPACE_BACKGROUND.clone();
  } else {
    scene.background.copy(SPACE_BACKGROUND);
  }
  scene.fog = null;
  hemisphere.intensity = BASE_HEMISPHERE_INTENSITY * 0.3;
  sun.visible = false;
  world.worldGroup.visible = false;
  if (world._ocean) world._ocean.visible = false;
  spaceScene.setVisible(true);
  planeController.setAuxiliaryLightsActive(true, 1.3);
  planeController.gravity = BASE_PLANE_GRAVITY * 0.14;
  planeController.propulsorLift = BASE_PROPULSOR_LIFT * 0.32;
}

function enterSpaceScenario(){
  if (activeScenario === SCENARIOS.SPACE) return;
  activeScenario = SCENARIOS.SPACE;
  applySpaceEnvironment();
  if (activeVehicle !== VEHICLE_MODES.PLANE){
    activatePlaneMode();
  }
  resetCar({ attachToDrone: true });
  hud.showMessage('Leaving atmosphere', 1400);
}

function enterPlanetScenario(){
  if (activeScenario === SCENARIOS.PLANET) return;
  activeScenario = SCENARIOS.PLANET;
  applyPlanetEnvironment();
  world.update(planeController.position);
  hud.showMessage('Atmospheric re-entry', 1400);
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
applyPlanetEnvironment();

enableWindowResizeHandling({ renderer, camera });

function clampAltitude(controller, ground){
  if (activeScenario === SCENARIOS.PLANET){
    if (controller.position.z > SKY_CEILING){
      controller.position.z = SKY_CEILING;
      if (controller.velocity.z > 0) controller.velocity.z = 0;
    }
  } else if (activeScenario === SCENARIOS.SPACE){
    if (controller.position.z > SPACE_CEILING){
      controller.position.z = SPACE_CEILING;
      if (controller.velocity.z > 0) controller.velocity.z = 0;
    }
  }
}

let lastTime = performance.now();

function setActiveVehicle(mode){
  if (mode === activeVehicle) return;
  if (activeScenario === SCENARIOS.SPACE && mode === VEHICLE_MODES.CAR){
    hud.showMessage('Ground vehicle unavailable in space', 1000);
    return;
  }
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
  const planeInputRaw = inputSample.plane;
  const planeInput = crashCooldown > 0
    ? {
        pitch: 0,
        yaw: 0,
        roll: 0,
        throttleAdjust: 0,
        brake: false,
        aim: { x: planeController.aim?.x ?? 0, y: planeController.aim?.y ?? 0 },
      }
    : planeInputRaw;
  const firePressed = crashCooldown > 0 ? false : !!inputSample.fire;

  if (crashCooldown > 0){
    crashCooldown = Math.max(0, crashCooldown - dt);
  }

  if (activeVehicle === VEHICLE_MODES.PLANE){
    planeController.update(dt, planeInput, {
      sampleGroundHeight: (x, y) => world.getHeightAt(x, y),
      clampAltitude,
    });

    const planeState = planeController.getState();

    const altitude = planeState.altitude ?? 0;
    if (activeScenario === SCENARIOS.PLANET && altitude > SPACE_TRANSITION_ALTITUDE){
      enterSpaceScenario();
    } else if (activeScenario === SCENARIOS.SPACE && altitude < SPACE_RETURN_ALTITUDE){
      enterPlanetScenario();
    }

    if (firePressed){
      projectileSystem.tryFire({
        position: planeState.position.clone(),
        orientation: planeState.orientation.clone(),
        velocity: planeState.velocity.clone(),
      });
    }

    if (crashCooldown <= 0 && activeScenario === SCENARIOS.PLANET){
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

    if (activeScenario === SCENARIOS.PLANET){
      rebaseWorldIfNeeded(planeController.position);
      world.update(planeState.position);
    }
    chaseCamera.update(planeState, dt, inputSample.cameraOrbit);

    hud.update({
      throttle: planeState.throttle,
      speed: planeState.speed,
      crashCount,
      elapsedTime: elapsedFlightTime,
      distance: traveledDistance,
    });
  } else if (activeScenario === SCENARIOS.PLANET){
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
  } else {
    chaseCamera.update(planeController.getState(), dt, inputSample.cameraOrbit);
  }

  spaceScene.update(dt, activeScenario === SCENARIOS.SPACE ? planeController.position : null);

  const originOffset = world.getOriginOffset ? world.getOriginOffset() : new THREE.Vector3();
  const spaceBodies = activeScenario === SCENARIOS.SPACE ? spaceScene.getBodies() : [];
  projectileSystem.update(dt, { scenario: activeScenario, originOffset, spaceBodies });

  renderer.render(scene, camera);
}

function rebaseWorldIfNeeded(referencePosition){
  if (activeScenario !== SCENARIOS.PLANET) return;
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
    projectileSystem.handleOriginShift(shift);
  }
}

requestAnimationFrame(animate);
