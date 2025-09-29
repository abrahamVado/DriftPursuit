const KEY_BINDINGS = {
  pitchDown: ['KeyW', 'ArrowUp'],
  pitchUp: ['KeyS', 'ArrowDown'],
  rollLeft: ['KeyA', 'ArrowLeft'],
  rollRight: ['KeyD', 'ArrowRight'],
  yawLeft: ['KeyQ'],
  yawRight: ['KeyE'],
  throttleUp: ['KeyR', 'ShiftLeft', 'ShiftRight'],
  throttleDown: ['KeyF', 'ControlLeft', 'ControlRight'],
  brake: ['KeyX'],
};

const DEADZONE = 0.08;

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
    this.pitch = 0;
    this.roll = 0;
    this.yaw = 0;
    this.throttleAdjust = 0;
    this.brake = false;
    this._onKeyDown = this.handleKeyDown.bind(this);
    this._onKeyUp = this.handleKeyUp.bind(this);
    element.addEventListener('keydown', this._onKeyDown);
    element.addEventListener('keyup', this._onKeyUp);
    this.element = element;
  }

  dispose(){
    if (!this.element) return;
    this.element.removeEventListener('keydown', this._onKeyDown);
    this.element.removeEventListener('keyup', this._onKeyUp);
    this.element = null;
  }

  handleKeyDown(event){
    this.activeKeys.add(event.code);
    const preventDefault = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code);
    if (preventDefault){
      event.preventDefault();
    }
  }

  handleKeyUp(event){
    this.activeKeys.delete(event.code);
    const preventDefault = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code);
    if (preventDefault){
      event.preventDefault();
    }
  }

  readState(){
    const pitch = applyDeadzone(applyDigitalAxis(KEY_BINDINGS.pitchDown, KEY_BINDINGS.pitchUp, this.activeKeys));
    const roll = applyDeadzone(applyDigitalAxis(KEY_BINDINGS.rollRight, KEY_BINDINGS.rollLeft, this.activeKeys));
    const yaw = applyDeadzone(applyDigitalAxis(KEY_BINDINGS.yawRight, KEY_BINDINGS.yawLeft, this.activeKeys));
    const throttleAdjust = applyDigitalAxis(KEY_BINDINGS.throttleUp, KEY_BINDINGS.throttleDown, this.activeKeys);
    const brake = KEY_BINDINGS.brake.some((key) => this.activeKeys.has(key));
    return { pitch, roll, yaw, throttleAdjust, brake };
  }
}

export function describeControls(){
  return [
    { label: 'Pitch', detail: 'W/S or ↑/↓ adjusts nose' },
    { label: 'Roll', detail: 'A/D or ←/→ banks the wings' },
    { label: 'Yaw', detail: 'Q/E rudder twist' },
    { label: 'Throttle', detail: 'R increases · F decreases' },
    { label: 'Brake', detail: 'X taps airbrake' },
  ];
}
