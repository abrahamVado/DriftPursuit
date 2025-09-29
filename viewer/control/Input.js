const CONTROL_KEY_SET = new Set([
  'KeyW', 'KeyS',
  'KeyA', 'KeyD',
  'ArrowUp', 'ArrowDown',
  'ArrowLeft', 'ArrowRight',
  'KeyQ', 'KeyE'
]);

const PREVENT_DEFAULT_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

const activeKeys = new Set();
let invertAxes = false;
let throttleHold = false;

const DEADZONE = 0.15;

function applyDigitalAxis(positiveKeys, negativeKeys) {
  let value = 0;
  for (const key of positiveKeys) {
    if (activeKeys.has(key)) {
      value += 1;
      break;
    }
  }
  for (const key of negativeKeys) {
    if (activeKeys.has(key)) {
      value -= 1;
      break;
    }
  }
  return value;
}

function applyDeadzone(value) {
  if (!Number.isFinite(value)) return 0;
  if (Math.abs(value) < DEADZONE) return 0;
  return Math.max(-1, Math.min(1, value));
}

function findFirstGamepad() {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
    return null;
  }
  const pads = navigator.getGamepads();
  if (!pads) return null;
  for (const pad of pads) {
    if (pad) return pad;
  }
  return null;
}

function extractGamepadState() {
  const pad = findFirstGamepad();
  if (!pad) return null;
  const axes = pad.axes || [];
  const buttons = pad.buttons || [];
  const yaw = applyDeadzone(axes[0] || 0);
  const pitch = applyDeadzone(-(axes[1] || 0));
  const roll = applyDeadzone(axes[2] !== undefined ? axes[2] : axes[3] || 0);
  let throttle = null;
  if (buttons[7] && typeof buttons[7].value === 'number') {
    throttle = Math.max(0, Math.min(1, buttons[7].value));
  } else if (axes[5] !== undefined) {
    throttle = Math.max(0, Math.min(1, (axes[5] + 1) / 2));
  }
  return { yaw, pitch, roll, throttle };
}

export function onKeyDown(code) {
  if (!CONTROL_KEY_SET.has(code)) {
    return { handled: false };
  }
  activeKeys.add(code);
  return { handled: true, preventDefault: PREVENT_DEFAULT_KEYS.has(code) };
}

export function onKeyUp(code) {
  if (!CONTROL_KEY_SET.has(code)) {
    return { handled: false };
  }
  activeKeys.delete(code);
  return { handled: true, preventDefault: PREVENT_DEFAULT_KEYS.has(code) };
}

export function setInvertAxes(enabled) {
  invertAxes = Boolean(enabled);
}

export function setThrottleHold(enabled) {
  throttleHold = Boolean(enabled);
}

export function getThrottleHold() {
  return throttleHold;
}

export function isControlKey(code) {
  return CONTROL_KEY_SET.has(code);
}

export function readControls() {
  const digitalYaw = applyDigitalAxis(['KeyE'], ['KeyQ']);
  const digitalPitch = applyDigitalAxis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']);
  const digitalRoll = applyDigitalAxis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']);

  const gamepad = extractGamepadState();
  let yaw = digitalYaw;
  let pitch = digitalPitch;
  let roll = digitalRoll;
  if (gamepad) {
    if (Math.abs(gamepad.yaw) > Math.abs(yaw)) yaw = gamepad.yaw;
    if (Math.abs(gamepad.pitch) > Math.abs(pitch)) pitch = gamepad.pitch;
    if (Math.abs(gamepad.roll) > Math.abs(roll)) roll = gamepad.roll;
  }

  if (invertAxes) {
    pitch *= -1;
    roll *= -1;
  }

  yaw = Math.max(-1, Math.min(1, yaw));
  pitch = Math.max(-1, Math.min(1, pitch));
  roll = Math.max(-1, Math.min(1, roll));

  let throttle = throttleHold ? 1 : 0;
  if (gamepad && typeof gamepad.throttle === 'number') {
    throttle = gamepad.throttle;
  }
  throttle = Math.max(0, Math.min(1, throttle));

  return { yaw, pitch, roll, throttle };
}
