const THREE = (typeof window !== 'undefined' ? window.THREE : globalThis?.THREE) ?? null;
if (!THREE) throw new Error('Sandbox InputManager requires THREE to be loaded globally');

const KEY_BINDINGS = {
  rollLeft: ['KeyA'],
  rollRight: ['KeyD'],
  pitchUp: ['KeyW'],
  pitchDown: ['KeyS'],
  brake: ['Space'],
};

const DEADZONE = 0.06;

function applyDigitalAxis(positiveKeys, negativeKeys, activeKeys){
  let value = 0;
  for (const key of positiveKeys){
    if (activeKeys.has(key)){
      value += 1;
      break;
    }
  }
  for (const key of negativeKeys){
    if (activeKeys.has(key)){
      value -= 1;
      break;
    }
  }
  return value;
}

function applyDeadzone(value){
  if (!Number.isFinite(value)) return 0;
  return Math.abs(value) < DEADZONE ? 0 : Math.max(-1, Math.min(1, value));
}

export class InputManager {
  constructor({ element = window } = {}){
    this.activeKeys = new Set();
    this.roll = 0;
    this.yaw = 0;
    this.brake = false;
    this.pointer = { x: 0, y: 0 };
    this.pointerTarget = { x: 0, y: 0 };
    this.pointerSmoothing = 9;
    this.pointerSensitivity = { yaw: 0.9, pitch: 0.8 };
    this.rollAssist = 0.55;
    this.throttleImpulse = 0;
    this._onKeyDown = this.handleKeyDown.bind(this);
    this._onKeyUp = this.handleKeyUp.bind(this);
    this._onPointerMove = this.handlePointerMove.bind(this);
    this._onPointerLeave = this.handlePointerLeave.bind(this);
    this._onWheel = this.handleWheel.bind(this);
    element.addEventListener('keydown', this._onKeyDown);
    element.addEventListener('keyup', this._onKeyUp);
    element.addEventListener('pointermove', this._onPointerMove);
    element.addEventListener('pointerleave', this._onPointerLeave);
    element.addEventListener('wheel', this._onWheel, { passive: false });
    this.element = element;
  }

  dispose(){
    if (!this.element) return;
    this.element.removeEventListener('keydown', this._onKeyDown);
    this.element.removeEventListener('keyup', this._onKeyUp);
    this.element.removeEventListener('pointermove', this._onPointerMove);
    this.element.removeEventListener('pointerleave', this._onPointerLeave);
    this.element.removeEventListener('wheel', this._onWheel);
    this.element = null;
  }

  handleKeyDown(event){
    this.activeKeys.add(event.code);
    const preventDefault = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(event.code);
    if (preventDefault){
      event.preventDefault();
    }
  }

  handleKeyUp(event){
    this.activeKeys.delete(event.code);
    const preventDefault = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(event.code);
    if (preventDefault){
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
  }

  handlePointerLeave(){
    this.pointerTarget.x = 0;
    this.pointerTarget.y = 0;
  }

  handleWheel(event){
    if (event.ctrlKey) return;
    event.preventDefault();
    const delta = THREE.MathUtils.clamp(-event.deltaY * 0.05, -12, 12);
    this.throttleImpulse += delta;
  }

  readState(dt = 0){
    const pointerBlend = dt > 0 ? 1 - Math.exp(-this.pointerSmoothing * dt) : 1;
    this.pointer.x += (this.pointerTarget.x - this.pointer.x) * pointerBlend;
    this.pointer.y += (this.pointerTarget.y - this.pointer.y) * pointerBlend;

    const rollDigital = applyDeadzone(applyDigitalAxis(KEY_BINDINGS.rollRight, KEY_BINDINGS.rollLeft, this.activeKeys));
    const pitchDigital = applyDeadzone(applyDigitalAxis(KEY_BINDINGS.pitchUp, KEY_BINDINGS.pitchDown, this.activeKeys));
    const throttleAdjust = this.throttleImpulse;
    this.throttleImpulse = 0;
    const brake = KEY_BINDINGS.brake.some((key) => this.activeKeys.has(key));

    const yaw = applyDeadzone(this.pointer.x * this.pointerSensitivity.yaw);
    const pitch = applyDeadzone(this.pointer.y * this.pointerSensitivity.pitch + pitchDigital);
    const roll = applyDeadzone(this.pointer.x * this.rollAssist + rollDigital);

    return { pitch, roll, yaw, throttleAdjust, brake };
  }
}

export function describeControls(){
  return [
    { label: 'Aim', detail: 'Move mouse to steer nose' },
    { label: 'Pitch', detail: 'Hold W to climb · S to descend' },
    { label: 'Roll', detail: 'A banks left · D banks right' },
    { label: 'Throttle', detail: 'Scroll mouse wheel' },
    { label: 'Brake', detail: 'Space for airbrake' },
  ];
}
