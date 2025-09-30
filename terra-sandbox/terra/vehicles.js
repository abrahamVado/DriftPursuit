function assignVector3(target, source){
  if (!target || source == null) return;
  if (Array.isArray(source) && source.length >= 3){
    target.set(source[0], source[1], source[2]);
    return;
  }
  const { x, y, z } = source ?? {};
  if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number'){
    target.set(x, y, z);
    return;
  }
  if (typeof x === 'number') target.x = x;
  if (typeof y === 'number') target.y = y;
  if (typeof z === 'number') target.z = z;
}

function assignQuaternion(target, source){
  if (!target || source == null) return;
  if (Array.isArray(source) && source.length >= 4){
    target.set(source[0], source[1], source[2], source[3]);
    return;
  }
  const { x, y, z, w } = source ?? {};
  if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number' && typeof w === 'number'){
    target.set(x, y, z, w);
    return;
  }
  if (typeof x === 'number') target.x = x;
  if (typeof y === 'number') target.y = y;
  if (typeof z === 'number') target.z = z;
  if (typeof w === 'number') target.w = w;
}

function syncControllerVisual(controller){
  if (!controller) return;
  if (controller.mesh){
    controller.mesh.position.copy(controller.position);
    controller.mesh.quaternion.copy(controller.orientation);
  }
}

export function createVehicleSystem({
  THREE,
  scene,
  chaseCamera,
  hud,
  hudPresets,
  projectileManager,
  collisionSystem,
  getWorld,
  localPlayerId,
  planeCameraConfig,
  carCameraConfig,
  maxDefaultVehicles = 5,
  skyCeiling = 1800,
  createPlaneMesh,
  createPlaneController,
  createCarRig,
  createCarController,
} = {}){
  const vehicles = new Map();
  const trackedVehicles = [];
  let activeVehicleId = null;

  const METERS_PER_LATITUDE_DEGREE = 111320;

  function sampleLatitude(position){
    if (!position) return 0;
    const value = position.y / METERS_PER_LATITUDE_DEGREE;
    return Number.isFinite(value) ? THREE.MathUtils.clamp(value, -90, 90) : 0;
  }

  function getWorldInstance(){
    return typeof getWorld === 'function' ? getWorld() : null;
  }

  function getGroundHeight(x, y){
    const world = getWorldInstance();
    if (world && typeof world.getHeightAt === 'function'){
      return world.getHeightAt(x, y);
    }
    return 0;
  }

  function getVehicleState(vehicle){
    if (!vehicle) return null;
    const modeState = vehicle.modes[vehicle.mode];
    if (!modeState) return null;
    if (typeof modeState.controller?.getState !== 'function') return null;
    return modeState.controller.getState();
  }

  function ensureVehicleVisibility(vehicle){
    if (!vehicle) return;
    const { plane, car } = vehicle.modes;
    if (plane?.mesh) plane.mesh.visible = vehicle.mode === 'plane';
    if (car?.rig?.carMesh) car.rig.carMesh.visible = vehicle.mode === 'car';
  }

  function applyHudControls(vehicle){
    if (!vehicle) return;
    const preset = hudPresets?.[vehicle.mode] ?? hudPresets?.plane;
    if (preset && hud?.setControls){
      hud.setControls(preset);
    }
  }

  function focusCameraOnVehicle(vehicle){
    if (!vehicle) return;
    const mode = vehicle.modes[vehicle.mode];
    if (!mode) return;
    chaseCamera?.setConfig?.(mode.cameraConfig);
    chaseCamera?.resetOrbit?.();
    const state = mode.controller?.getState ? mode.controller.getState() : null;
    if (state){
      chaseCamera?.snapTo?.(state);
    }
    applyHudControls(vehicle);
  }

  function switchVehicleMode(vehicle, mode){
    if (!vehicle || !mode) return;
    if (vehicle.mode === mode) return;
    if (!vehicle.modes?.[mode]) return;
    vehicle.mode = mode;
    ensureVehicleVisibility(vehicle);
    if (vehicle.id === activeVehicleId){
      applyHudControls(vehicle);
      focusCameraOnVehicle(vehicle);
    }
  }

  function clampPlaneAltitude(controller, ground){
    if (!controller) return;
    const minAltitude = ground + 16;
    if (controller.position.z < minAltitude){
      controller.position.z = minAltitude;
      if (controller.velocity.z < 0) controller.velocity.z = 0;
    }
    if (controller.position.z > skyCeiling){
      controller.position.z = skyCeiling;
      if (controller.velocity.z > 0) controller.velocity.z = 0;
    }
  }

  function computeSpawnTransform(index){
    const angle = index * (Math.PI * 2 / Math.max(1, maxDefaultVehicles));
    const radius = 420 + (index % 3) * 60;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const ground = getGroundHeight(x, y);
    const highestAllowed = skyCeiling - 40;
    const desiredAltitude = ground + Math.max(skyCeiling * 0.72, 420);
    const minimumAltitude = ground + 120;
    const planeAltitude = Math.max(minimumAltitude, Math.min(highestAllowed, desiredAltitude));
    const planePos = new THREE.Vector3(x, y, planeAltitude);
    const carPos = new THREE.Vector3(x + 28, y - 28, ground + 2.6);
    const yaw = angle + Math.PI / 2;
    return {
      plane: { position: planePos, yaw },
      car: { position: carPos, yaw },
    };
  }

  function createVehicleEntry(id, { isBot = false, initialMode = 'plane', spawnIndex = vehicles.size } = {}){
    if (!id) return null;
    const transform = computeSpawnTransform(spawnIndex);

    const planeMesh = createPlaneMesh?.();
    if (planeMesh) scene?.add?.(planeMesh);

    const planeController = createPlaneController?.();
    planeController?.attachMesh?.(planeMesh, {
      turretYawGroup: planeMesh?.userData?.turretYawGroup,
      turretPitchGroup: planeMesh?.userData?.turretPitchGroup,
      stickYaw: planeMesh?.userData?.turretStickYaw,
      stickPitch: planeMesh?.userData?.turretStickPitch,
    });
    const divePitch = THREE.MathUtils.degToRad(-62);
    planeController?.reset?.({
      position: transform.plane.position,
      yaw: transform.plane.yaw,
      pitch: divePitch,
      throttle: 1,
    });
    if (planeController){
      planeController.throttle = 1;
      planeController.targetThrottle = 1;
      const diveDirection = new THREE.Vector3(0, 1, 0).applyQuaternion(planeController.orientation).normalize();
      const targetSpeed = planeController.maxBoostSpeed ?? planeController.maxSpeed ?? 0;
      planeController.speed = targetSpeed;
      planeController.velocity.copy(diveDirection).multiplyScalar(targetSpeed);
      planeController.propulsorHeat = 1;
      planeController._applyPropulsorIntensity?.(1);
    }

    const carRig = createCarRig?.();
    if (carRig?.carMesh) scene?.add?.(carRig.carMesh);

    const carController = createCarController?.();
    carController?.attachMesh?.(carRig?.carMesh, {
      stickYaw: carRig?.stickYaw,
      stickPitch: carRig?.stickPitch,
      towerGroup: carRig?.towerGroup,
      towerHead: carRig?.towerHead,
      wheels: carRig?.wheels,
    });
    carController?.reset?.({
      position: transform.car.position,
      yaw: transform.car.yaw,
    });

    const entry = {
      id,
      isBot,
      mode: initialMode,
      modes: {
        plane: {
          controller: planeController,
          mesh: planeMesh,
          cameraConfig: planeCameraConfig,
          muzzle: planeMesh?.userData?.turretMuzzle ?? null,
        },
        car: {
          controller: carController,
          rig: carRig,
          cameraConfig: carCameraConfig,
          muzzle: carRig?.carMesh?.userData?.turretMuzzle ?? null,
        },
      },
      stats: {
        crashCount: 0,
        elapsed: 0,
        distance: 0,
        throttle: 0,
        speed: 0,
        altitude: 0,
        latitude: sampleLatitude(transform.plane.position),
        lastPosition: transform.plane.position.clone(),
      },
      behaviorSeed: Math.random() * Math.PI * 2,
      spawnTransform: {
        plane: {
          position: transform.plane.position.clone(),
          yaw: transform.plane.yaw,
        },
        car: {
          position: transform.car.position.clone(),
          yaw: transform.car.yaw,
        },
      },
    };

    vehicles.set(id, entry);
    ensureVehicleVisibility(entry);
    const initialState = getVehicleState(entry);
    if (initialState?.position){
      entry.stats.lastPosition.copy(initialState.position);
      if (Number.isFinite(initialState.throttle)){
        entry.stats.throttle = initialState.throttle;
      }
      if (Number.isFinite(initialState.speed)){
        entry.stats.speed = initialState.speed;
      }
      if (Number.isFinite(initialState.altitude)){
        entry.stats.altitude = initialState.altitude;
      }
      if (initialState.position){
        entry.stats.latitude = sampleLatitude(initialState.position);
      }
    }

    return entry;
  }

  function removeVehicle(id){
    const entry = vehicles.get(id);
    if (!entry) return;
    projectileManager?.clearByOwner?.(id);
    if (entry.modes.plane?.mesh){
      scene?.remove?.(entry.modes.plane.mesh);
    }
    if (entry.modes.car?.rig?.carMesh){
      scene?.remove?.(entry.modes.car.rig.carMesh);
    }
    vehicles.delete(id);
    if (activeVehicleId === id){
      activeVehicleId = null;
    }
  }

  function selectActiveVehicle(preferredId = null){
    const previous = activeVehicleId;
    if (preferredId && vehicles.has(preferredId)){
      activeVehicleId = preferredId;
    } else if (activeVehicleId && vehicles.has(activeVehicleId)){
      // keep current selection
    } else {
      let fallback = null;
      for (const [id, vehicle] of vehicles.entries()){
        if (!vehicle.isBot){
          activeVehicleId = id;
          fallback = null;
          break;
        }
        if (!fallback) fallback = id;
      }
      if (!vehicles.has(activeVehicleId) && fallback){
        activeVehicleId = fallback;
      }
    }

    if (activeVehicleId && !vehicles.has(activeVehicleId)){
      activeVehicleId = null;
    }
    if (previous !== activeVehicleId){
      const nextVehicle = activeVehicleId ? vehicles.get(activeVehicleId) : null;
      if (nextVehicle){
        focusCameraOnVehicle(nextVehicle);
      }
    }
  }

  function setActiveVehicle(id){
    if (!id || !vehicles.has(id)) return;
    if (activeVehicleId === id) return;
    activeVehicleId = id;
    const vehicle = vehicles.get(activeVehicleId);
    focusCameraOnVehicle(vehicle);
  }

  function cycleActiveVehicle(delta){
    if (vehicles.size === 0) return;
    const ids = Array.from(vehicles.keys());
    if (ids.length === 0) return;
    if (!activeVehicleId || !vehicles.has(activeVehicleId)){
      selectActiveVehicle();
    }
    const currentIndex = ids.indexOf(activeVehicleId);
    const index = currentIndex === -1 ? 0 : currentIndex;
    let next = (index + delta) % ids.length;
    if (next < 0) next += ids.length;
    const nextId = ids[next];
    if (nextId !== activeVehicleId){
      setActiveVehicle(nextId);
    }
  }

  function resetVehicleStats(vehicle){
    const state = getVehicleState(vehicle);
    if (!state) return;
    vehicle.stats.elapsed = 0;
    vehicle.stats.distance = 0;
    vehicle.stats.altitude = Number.isFinite(state.altitude) ? state.altitude : 0;
    vehicle.stats.latitude = sampleLatitude(state.position);
    vehicle.stats.lastPosition.copy(state.position);
    vehicle.stats.crashCount = 0;
  }

  function registerVehicleCrash(vehicle, { message = 'Impact detected' } = {}){
    if (!vehicle) return;
    if (vehicle.stats){
      vehicle.stats.crashCount = (vehicle.stats.crashCount ?? 0) + 1;
    }
    if (message){
      hud?.showMessage?.(message);
    }
    if (vehicle.id === activeVehicleId){
      focusCameraOnVehicle(vehicle);
    }
  }

  function resetCarAfterCrash(vehicle){
    if (!vehicle) return;
    const spawn = vehicle.spawnTransform?.car;
    const carMode = vehicle.modes?.car;
    if (!spawn || !carMode?.controller) return;
    carMode.controller.reset({ position: spawn.position, yaw: spawn.yaw });
    syncControllerVisual(carMode.controller);
    if (vehicle.stats){
      if (vehicle.stats.lastPosition){
        vehicle.stats.lastPosition.copy(carMode.controller.position);
      } else {
        vehicle.stats.lastPosition = carMode.controller.position.clone();
      }
      vehicle.stats.speed = 0;
      vehicle.stats.throttle = 0;
    }
  }

  function handleProjectileHit(vehicle, projectile){
    if (!vehicle) return;
    if (projectile?.mesh?.position){
      projectileManager?.triggerExplosion?.({
        position: projectile.mesh.position.clone(),
        ammoId: projectile.ammo?.id ?? null,
      });
    }
    registerVehicleCrash(vehicle, { message: 'Direct hit!' });
    if (vehicle.mode === 'car'){
      resetCarAfterCrash(vehicle);
    }
  }

  function fireActiveVehicleProjectile(){
    if (!activeVehicleId) return false;
    const vehicle = vehicles.get(activeVehicleId);
    if (!vehicle) return false;
    const modeName = vehicle.mode;
    const mode = vehicle.modes?.[modeName];
    if (!mode) return false;

    let muzzle = null;
    const controller = mode.controller ?? null;

    if (modeName === 'plane'){
      muzzle = mode.mesh?.userData?.turretMuzzle ?? mode.muzzle ?? null;
    } else if (modeName === 'car'){
      const carMesh = mode.rig?.carMesh ?? null;
      muzzle = carMesh?.userData?.turretMuzzle ?? mode.muzzle ?? null;
    }

    if (!muzzle) return false;

    const inheritVelocity = controller?.velocity ?? null;
    const projectile = projectileManager?.spawnFromMuzzle?.(muzzle, {
      ownerId: vehicle.id,
      inheritVelocity,
    });
    return !!projectile;
  }

  function updateVehicleStats(vehicle, dt){
    const state = getVehicleState(vehicle);
    if (!state) return;
    const stats = vehicle.stats;
    if (!stats) return;
    stats.elapsed += dt;
    stats.throttle = state.throttle ?? stats.throttle;
    stats.speed = state.speed ?? stats.speed;
    if (Number.isFinite(state.altitude)){
      stats.altitude = state.altitude;
    }
    if (state.position){
      stats.latitude = sampleLatitude(state.position);
    }
    if (stats.lastPosition){
      stats.distance += state.position.distanceTo(stats.lastPosition);
      stats.lastPosition.copy(state.position);
    } else {
      stats.lastPosition = state.position.clone();
    }
  }

  function updatePlaneBot(vehicle, dt, elapsedTime){
    const controller = vehicle.modes.plane.controller;
    if (!controller) return;
    const oscillation = elapsedTime * 0.35 + vehicle.behaviorSeed;
    const input = {
      pitch: Math.sin(oscillation * 0.9) * 0.24,
      yaw: 0.14 + Math.sin(oscillation * 0.35) * 0.06,
      roll: Math.sin(oscillation * 0.65) * 0.42,
      throttleAdjust: Math.sin(oscillation * 0.18) * 0.05,
      brake: false,
      aim: {
        x: Math.sin(oscillation * 0.52) * 0.65,
        y: Math.cos(oscillation * 0.41) * 0.5,
      },
    };
    controller.update(dt, input, {
      clampAltitude: clampPlaneAltitude,
      sampleGroundHeight: (x, y) => getGroundHeight(x, y),
    });
  }

  function updateCarBot(vehicle, dt, elapsedTime){
    const controller = vehicle.modes.car.controller;
    if (!controller) return;
    const oscillation = elapsedTime * 0.6 + vehicle.behaviorSeed;
    const input = {
      throttle: 0.4 + Math.sin(oscillation) * 0.35,
      steer: Math.sin(oscillation * 0.7) * 0.65,
      brake: false,
      aim: {
        x: Math.sin(oscillation * 1.1) * 0.5,
        y: Math.cos(oscillation * 0.9) * 0.35,
      },
    };
    controller.update(dt, input, {
      sampleGroundHeight: (x, y) => getGroundHeight(x, y),
    });
  }

  function updateLocalVehicle(vehicle, dt, inputSample){
    if (!vehicle) return;
    const modeRequest = inputSample?.modeRequest;
    if (modeRequest && vehicle.modes?.[modeRequest]){
      switchVehicleMode(vehicle, modeRequest);
      if (vehicle.id === localPlayerId && activeVehicleId !== localPlayerId){
        setActiveVehicle(localPlayerId);
      }
    }

    const currentMode = vehicle.mode;
    if (currentMode === 'plane'){
      const controller = vehicle.modes.plane.controller;
      if (!controller) return;
      const planeInput = inputSample?.plane ?? {};
      controller.update(dt, {
        pitch: planeInput.pitch ?? 0,
        roll: planeInput.roll ?? 0,
        yaw: planeInput.yaw ?? 0,
        throttleAdjust: planeInput.throttleAdjust ?? 0,
        brake: planeInput.brake ?? false,
        aim: planeInput.aim ?? { x: 0, y: 0 },
      }, {
        clampAltitude: clampPlaneAltitude,
        sampleGroundHeight: (x, y) => getGroundHeight(x, y),
      });
    } else if (currentMode === 'car'){
      const controller = vehicle.modes.car.controller;
      if (!controller) return;
      const carInput = inputSample?.car ?? {};
      controller.update(dt, {
        throttle: carInput.throttle ?? 0,
        steer: carInput.steer ?? 0,
        brake: carInput.brake ?? false,
        aim: carInput.aim ?? { x: 0, y: 0 },
      }, {
        sampleGroundHeight: (x, y) => getGroundHeight(x, y),
      });
    }
  }

  function updateVehicleController(vehicle, dt, elapsedTime, inputSample, movementScale){
    const clampedScale = Number.isFinite(movementScale) ? Math.max(0, movementScale) : 1;
    const movementDt = dt * clampedScale;
    if (!vehicle) return;
    if (vehicle.isBot){
      if (vehicle.mode === 'plane'){
        updatePlaneBot(vehicle, movementDt, elapsedTime);
      } else {
        updateCarBot(vehicle, movementDt, elapsedTime);
      }
    } else if (vehicle.id === localPlayerId){
      updateLocalVehicle(vehicle, movementDt, inputSample);
    }
  }

  function stepVehicleAttachments(vehicle, dt){
    if (!vehicle) return;
    const plane = vehicle.modes?.plane;
    if (plane?.controller?.stepTurretAim){
      plane.controller.stepTurretAim(dt);
    }
  }

  function updateTrackedVehicles(){
    trackedVehicles.length = 0;
    for (const [id, vehicle] of vehicles.entries()){
      const state = getVehicleState(vehicle);
      if (!state) continue;
      trackedVehicles.push({ id, mode: vehicle.mode, state });
    }
  }

  function evaluateCollisions(vehicle){
    if (!vehicle || vehicle.mode !== 'plane') return;
    const state = getVehicleState(vehicle);
    if (!state) return;
    const result = collisionSystem?.evaluate?.(state);
    if (result?.crashed){
      registerVehicleCrash(vehicle, { message: 'Impact detected' });
    }
  }

  function getHudData(vehicle){
    if (!vehicle){
      return { throttle: 0, speed: 0, crashCount: 0, elapsedTime: 0, distance: 0 };
    }
    return {
      throttle: vehicle.stats.throttle,
      speed: vehicle.stats.speed,
      crashCount: vehicle.stats.crashCount,
      elapsedTime: vehicle.stats.elapsed,
      distance: vehicle.stats.distance,
      altitude: vehicle.stats.altitude,
      latitude: vehicle.stats.latitude,
    };
  }

  function spawnDefaultVehicles(){
    for (let i = 0; i < maxDefaultVehicles; i += 1){
      const id = `bot-${i + 1}`;
      if (vehicles.has(id)) continue;
      const vehicle = createVehicleEntry(id, { isBot: true, spawnIndex: i });
      if (vehicle){
        vehicle.mode = 'plane';
        ensureVehicleVisibility(vehicle);
      }
    }
    selectActiveVehicle();
  }

  function removeOneBot(){
    for (const [id, vehicle] of vehicles.entries()){
      if (vehicle.isBot){
        removeVehicle(id);
        return true;
      }
    }
    return false;
  }

  function handlePlayerJoin(id, options = {}){
    if (!id) return;
    if (vehicles.has(id)) return;
    const vehicle = createVehicleEntry(id, { isBot: !!options.isBot, initialMode: options.initialMode ?? 'plane' });
    if (!vehicle) return;
    if (!vehicle.isBot){
      removeOneBot();
      setActiveVehicle(id);
    } else {
      selectActiveVehicle();
    }
    ensureVehicleVisibility(vehicle);
  }

  function handlePlayerLeave(id){
    if (!id) return;
    const existed = vehicles.has(id);
    removeVehicle(id);
    if (vehicles.size === 0){
      spawnDefaultVehicles();
    } else if (existed){
      selectActiveVehicle();
    }
  }

  function applyVehicleSnapshot(id, snapshot = {}){
    const vehicle = vehicles.get(id);
    if (!vehicle) return;
    if (snapshot.mode && vehicle.modes[snapshot.mode]){
      vehicle.mode = snapshot.mode;
      ensureVehicleVisibility(vehicle);
      if (activeVehicleId === id){
        applyHudControls(vehicle);
      }
    }

    const mode = vehicle.modes[vehicle.mode];
    if (!mode) return;
    const controller = mode.controller;
    if (!controller) return;

    if (snapshot.position) assignVector3(controller.position, snapshot.position);
    if (snapshot.velocity) assignVector3(controller.velocity, snapshot.velocity);
    if (snapshot.orientation) assignQuaternion(controller.orientation, snapshot.orientation);
    if (typeof snapshot.speed === 'number') controller.speed = snapshot.speed;
    if (typeof snapshot.throttle === 'number') controller.throttle = snapshot.throttle;
    if (typeof snapshot.targetThrottle === 'number') controller.targetThrottle = snapshot.targetThrottle;

    const planeMode = vehicle.modes?.plane;
    if (planeMode?.controller?.setTurretAimTarget){
      const turretAim = snapshot.planeAim ?? snapshot.aircraftAim ?? snapshot.airAim ?? snapshot.turretAim ?? null;
      if (turretAim){
        planeMode.controller.setTurretAimTarget(turretAim, { immediate: !!snapshot.instantAim });
      }
    }
    if (planeMode?.controller?.setTurretOrientation){
      const turretOrientation = snapshot.turretOrientation ?? snapshot.turretAngles ?? snapshot.turret ?? null;
      if (turretOrientation){
        planeMode.controller.setTurretOrientation(turretOrientation);
      }
    }

    syncControllerVisual(controller);

    if (snapshot.resetStats){
      resetVehicleStats(vehicle);
    } else {
      const state = controller.getState ? controller.getState() : null;
      if (state){
        vehicle.stats.throttle = state.throttle ?? vehicle.stats.throttle;
        vehicle.stats.speed = state.speed ?? vehicle.stats.speed;
        if (!vehicle.stats.lastPosition){
          vehicle.stats.lastPosition = state.position.clone();
        } else {
          vehicle.stats.lastPosition.copy(state.position);
        }
      }
    }
  }

  function handleFocusShortcut(){
    if (!activeVehicleId) return;
    const vehicle = vehicles.get(activeVehicleId);
    focusCameraOnVehicle(vehicle);
  }

  function update({ dt, elapsedTime, inputSample, movementScale = 1 }){
    const clampedScale = Number.isFinite(movementScale) ? Math.max(0, movementScale) : 1;
    for (const vehicle of vehicles.values()){
      updateVehicleController(vehicle, dt, elapsedTime, inputSample, clampedScale);
      stepVehicleAttachments(vehicle, dt * clampedScale);
      updateVehicleStats(vehicle, dt);
    }

    selectActiveVehicle();

    const activeVehicle = activeVehicleId ? vehicles.get(activeVehicleId) : null;
    const activeState = activeVehicle ? getVehicleState(activeVehicle) : null;

    updateTrackedVehicles();
    evaluateCollisions(activeVehicle);

    const hudData = getHudData(activeVehicle);

    return { activeVehicle, activeState, hudData };
  }

  function getTrackedVehiclesSnapshot(){
    return trackedVehicles.map((entry) => ({
      id: entry.id,
      mode: entry.mode,
      position: entry.state.position.clone(),
      velocity: entry.state.velocity.clone(),
    }));
  }

  function getVehicles(){
    return vehicles;
  }

  return {
    createVehicleEntry,
    handlePlayerJoin,
    handlePlayerLeave,
    cycleActiveVehicle,
    setActiveVehicle,
    handleFocusShortcut,
    fireActiveVehicleProjectile,
    spawnDefaultVehicles,
    applyVehicleSnapshot,
    update,
    getActiveVehicle: () => (activeVehicleId ? vehicles.get(activeVehicleId) : null),
    getActiveVehicleId: () => activeVehicleId,
    getTrackedVehicles: getTrackedVehiclesSnapshot,
    getVehicles,
    getVehicleState,
    registerVehicleCrash,
    handleProjectileHit,
    teleportActiveVehicle,
  };
}
  function teleportActiveVehicle({ position = null, velocity = null } = {}){
    if (!activeVehicleId) return false;
    const vehicle = vehicles.get(activeVehicleId);
    if (!vehicle) return false;
    const mode = vehicle.modes?.[vehicle.mode];
    if (!mode?.controller) return false;

    if (position){
      mode.controller.position.copy(position);
    }
    if (velocity){
      mode.controller.velocity.copy(velocity);
    } else {
      mode.controller.velocity.set(0, 0, 0);
    }

    syncControllerVisual(mode.controller);

    if (vehicle.stats){
      const state = mode.controller.getState ? mode.controller.getState() : null;
      if (state){
        vehicle.stats.throttle = state.throttle ?? vehicle.stats.throttle;
        vehicle.stats.speed = state.speed ?? vehicle.stats.speed;
        vehicle.stats.altitude = Number.isFinite(state.altitude) ? state.altitude : vehicle.stats.altitude;
        vehicle.stats.latitude = state.position ? sampleLatitude(state.position) : vehicle.stats.latitude;
        if (vehicle.stats.lastPosition){
          vehicle.stats.lastPosition.copy(state.position);
        } else {
          vehicle.stats.lastPosition = state.position.clone();
        }
      } else if (position){
        if (vehicle.stats.lastPosition){
          vehicle.stats.lastPosition.copy(position);
        } else {
          vehicle.stats.lastPosition = position.clone ? position.clone() : new THREE.Vector3(position.x ?? 0, position.y ?? 0, position.z ?? 0);
        }
      }
    }

    return true;
  }
