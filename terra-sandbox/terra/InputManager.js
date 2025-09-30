import { requireTHREE } from '../shared/threeSetup.js';

const THREE = requireTHREE();

const DEFAULT_KEY_BINDINGS = {
  carThrottleForward: ['KeyW', 'ArrowUp'],
  carThrottleReverse: ['KeyS', 'ArrowDown'],
  carSteerLeft: ['KeyA', 'ArrowLeft'],
  carSteerRight: ['KeyD', 'ArrowRight'],
  carBrake: ['ShiftLeft', 'ShiftRight'],
  planePitchUp: ['KeyS', 'ArrowDown'],
  planePitchDown: ['KeyW', 'ArrowUp'],
  planeRollLeft: ['KeyA', 'ArrowLeft'],
  planeRollRight: ['KeyD', 'ArrowRight'],
  planeYawLeft: ['KeyQ'],
  planeYawRight: ['KeyE'],
  planeThrottleUp: ['ShiftLeft', 'ShiftRight'],
  planeThrottleDown: ['ControlLeft', 'ControlRight'],
  planeBrake: ['KeyB'],
  modePlane: ['Digit1'],
  modeCar: ['Digit2'],
};

function applyDigitalAxis(positive = [], negative = [], activeKeys){
  let value = 0;
  for (const key of positive){
    if (activeKeys.has(key)){ value += 1; break; }
  }
  for (const key of negative){
    if (activeKeys.has(key)){ value -= 1; break; }
  }
  return value;
}

function clampNormalized(value){
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.max(-1, Math.min(1, value));
  return Math.abs(clamped) < 0.001 ? 0 : clamped;
}

export class TerraInputManager {
  constructor({ element = window, pointerSmoothing = 9, pointerSensitivity = { x: 0.85, y: 0.8 }, keyBindings = {} } = {}){
    this.element = element;
    this.keyBindings = { ...DEFAULT_KEY_BINDINGS, ...keyBindings };
    this.pointerSmoothing = pointerSmoothing;
    this.pointerSensitivity = {
      x: pointerSensitivity.x ?? 0.85,
      y: pointerSensitivity.y ?? 0.8,
    };

    this.pointer = { x: 0, y: 0 };
    this.pointerTarget = { x: 0, y: 0 };
    this.cameraOrbitDelta = { x: 0, y: 0 };
    this.orbitActive = false;
    this.throttleImpulse = 0;
    this.activeKeys = new Set();
    this.pendingMode = null;

    this._onKeyDown = this.handleKeyDown.bind(this);
    this._onKeyUp = this.handleKeyUp.bind(this);
    this._onPointerMove = this.handlePointerMove.bind(this);
    this._onPointerLeave = this.handlePointerLeave.bind(this);
    this._onPointerDown = this.handlePointerDown.bind(this);
    this._onPointerUp = this.handlePointerUp.bind(this);
    this._onWheel = this.handleWheel.bind(this);
    this._onContextMenu = (event) => event.preventDefault();

    element.addEventListener('keydown', this._onKeyDown);
    element.addEventListener('keyup', this._onKeyUp);
    element.addEventListener('pointermove', this._onPointerMove);
    element.addEventListener('pointerleave', this._onPointerLeave);
    element.addEventListener('pointerdown', this._onPointerDown);
    element.addEventListener('pointerup', this._onPointerUp);
    element.addEventListener('wheel', this._onWheel, { passive: false });
    element.addEventListener('contextmenu', this._onContextMenu);
  }

  dispose(){
    if (!this.element) return;
    this.element.removeEventListener('keydown', this._onKeyDown);
    this.element.removeEventListener('keyup', this._onKeyUp);
    this.element.removeEventListener('pointermove', this._onPointerMove);
    this.element.removeEventListener('pointerleave', this._onPointerLeave);
    this.element.removeEventListener('pointerdown', this._onPointerDown);
    this.element.removeEventListener('pointerup', this._onPointerUp);
    this.element.removeEventListener('wheel', this._onWheel);
    this.element.removeEventListener('contextmenu', this._onContextMenu);
    this.element = null;
  }

  handleKeyDown(event){
    this.activeKeys.add(event.code);
    if (this.keyBindings.modePlane.includes(event.code)){
      this.pendingMode = 'plane';
      event.preventDefault();
    } else if (this.keyBindings.modeCar.includes(event.code)){
      this.pendingMode = 'car';
      event.preventDefault();
    }

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)){
      event.preventDefault();
    }
  }

  handleKeyUp(event){
    this.activeKeys.delete(event.code);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)){
      event.preventDefault();
    }
  }

  handlePointerMove(event){
    const rect = this.element === window
      ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
      : this.element.getBoundingClientRect();

    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const nx = ((event.clientX - rect.left) / width - 0.5) * 2;
    const ny = (0.5 - (event.clientY - rect.top) / height) * 2;

    this.pointerTarget.x = THREE.MathUtils.clamp(nx, -1.2, 1.2);
    this.pointerTarget.y = THREE.MathUtils.clamp(ny, -1.2, 1.2);

    const buttons = event.buttons ?? 0;
    if ((buttons & 2) === 2){
      this.cameraOrbitDelta.x += event.movementX ?? 0;
      this.cameraOrbitDelta.y += event.movementY ?? 0;
    }
  }

  handlePointerLeave(){
    this.pointerTarget.x = 0;
    this.pointerTarget.y = 0;
    this.orbitActive = false;
  }

  handlePointerDown(event){
    if (event.button === 2){
      this.orbitActive = true;
    }
  }

  handlePointerUp(event){
    if (event.button === 2){
      this.orbitActive = false;
    }
  }

  handleWheel(event){
    if (event.ctrlKey) return;
    event.preventDefault();
    const delta = THREE.MathUtils.clamp(-event.deltaY * 0.002, -2, 2);
    this.throttleImpulse += delta;
  }

  readState(dt = 0){
    const blend = dt > 0 ? 1 - Math.exp(-this.pointerSmoothing * dt) : 1;
    this.pointer.x += (this.pointerTarget.x - this.pointer.x) * blend;
    this.pointer.y += (this.pointerTarget.y - this.pointer.y) * blend;

    const throttleImpulse = this.throttleImpulse;
    this.throttleImpulse = 0;

    const planePitch = clampNormalized(applyDigitalAxis(
      this.keyBindings.planePitchUp,
      this.keyBindings.planePitchDown,
      this.activeKeys,
    ));
    const planeRoll = clampNormalized(applyDigitalAxis(
      this.keyBindings.planeRollRight,
      this.keyBindings.planeRollLeft,
      this.activeKeys,
    ));
    const planeYaw = clampNormalized(applyDigitalAxis(
      this.keyBindings.planeYawRight,
      this.keyBindings.planeYawLeft,
      this.activeKeys,
    ));
    const planeThrottleAdjust = clampNormalized(applyDigitalAxis(
      this.keyBindings.planeThrottleUp,
      this.keyBindings.planeThrottleDown,
      this.activeKeys,
    )) + throttleImpulse;
    const planeBrake = this.keyBindings.planeBrake.some((code) => this.activeKeys.has(code));

    const carThrottle = clampNormalized(applyDigitalAxis(
      this.keyBindings.carThrottleForward,
      this.keyBindings.carThrottleReverse,
      this.activeKeys,
    ));
    const carSteer = clampNormalized(applyDigitalAxis(
      this.keyBindings.carSteerRight,
      this.keyBindings.carSteerLeft,
      this.activeKeys,
    ));
    const carBrake = this.keyBindings.carBrake.some((code) => this.activeKeys.has(code));

    const aim = {
      x: clampNormalized(this.pointer.x * this.pointerSensitivity.x),
      y: clampNormalized(this.pointer.y * this.pointerSensitivity.y),
    };

    const cameraOrbit = {
      yawDelta: this.cameraOrbitDelta.x * 0.0026,
      pitchDelta: this.cameraOrbitDelta.y * 0.0022,
      active: this.orbitActive,
    };
    this.cameraOrbitDelta.x = 0;
    this.cameraOrbitDelta.y = 0;

    const modeRequest = this.pendingMode;
    this.pendingMode = null;

    return {
      plane: {
        pitch: planePitch,
        roll: planeRoll,
        yaw: planeYaw,
        throttleAdjust: planeThrottleAdjust,
        brake: planeBrake,
        aim: { ...aim },
      },
      car: {
        throttle: carThrottle,
        steer: carSteer,
        brake: carBrake,
        aim: { ...aim },
      },
      cameraOrbit,
      modeRequest,
    };
  }
}
