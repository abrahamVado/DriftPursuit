// InputManager.js
// Three.js r150+
// Unified controls: mouse aim (yaw/pitch), roll (A/D), throttle (wheel or W/S), airbrake (Space)

const THREE = (typeof window !== 'undefined' ? window.THREE : globalThis?.THREE) ?? null;
if (!THREE) throw new Error('Sandbox InputManager requires THREE to be loaded globally');

const DEFAULT_KEY_BINDINGS = {
  rollLeft: ['KeyA'],
  rollRight: ['KeyD'],
  pitchUp: ['KeyW'],
  pitchDown: ['KeyS'],
  brake: ['Space'],
};

const DEADZONE = 0.06;

function applyDigitalAxis(positiveKeys, negativeKeys, activeKeys) {
  let value = 0;
  if (positiveKeys) {
    for (const key of positiveKeys) {
      if (activeKeys.has(key)) { value += 1; break; }
    }
  }
  if (negativeKeys) {
    for (const key of negativeKeys) {
      if (activeKeys.has(key)) { value -= 1; break; }
    }
  }
  return value;
}

function applyDeadzone(value) {
  if (!Number.isFinite(value)) return 0;
  const v = Math.max(-1, Math.min(1, value));
  return Math.abs(v) < DEADZONE ? 0 : v;
}

/**
 * Options:
 * - element: event target (default window)
 * - useMouseWheelThrottle: boolean (default true). If true, scroll wheel adds throttle impulses.
 * - useKeyboardThrottle: boolean (default true). If true, W/S (or custom bindings) adjust throttle each frame.
 * - useKeyboardPitch: boolean (default false). If true, W/S (or custom bindings) also affect pitch.
 *   NOTE: If both useKeyboardThrottle and useKeyboardPitch are true, W/S will contribute to BOTH (common in arcade modes).
 * - pointerSmoothing: number (1/s) for exponential smoothing of pointer (default 9)
 * - pointerSensitivity: { yaw, pitch } multipliers
 * - rollAssist: mixes mouse X into roll (default 0.55)
 * - keyBindings: override any of DEFAULT_KEY_BINDINGS
 */
export class InputManager {
  constructor({
    element = window,
    useMouseWheelThrottle = true,
    useKeyboardThrottle = true,
    useKeyboardPitch = false,
    pointerSmoothing = 9,
    pointerSensitivity = { yaw: 0.9, pitch: 0.8 },
    rollAssist = 0.55,
    keyBindings = {},
  } = {}) {
    this.element = element;

    this.keyBindings = {
      ...DEFAULT_KEY_BINDINGS,
      ...keyBindings,
    };

    this.useMouseWheelThrottle = !!useMouseWheelThrottle;
    this.useKeyboardThrottle = !!useKeyboardThrottle;
    this.useKeyboardPitch = !!useKeyboardPitch;

    this.activeKeys = new Set();
    this.brake = false;

    // analog-ish state
    this.pointer = { x: 0, y: 0 };          // smoothed cursor in [-1..1]
    this.pointerTarget = { x: 0, y: 0 };    // immediate cursor sample
    this.pointerSmoothing = pointerSmoothing;
    this.pointerSensitivity = { yaw: pointerSensitivity.yaw ?? 0.9, pitch: pointerSensitivity.pitch ?? 0.8 };

    // mix mouse X into roll a bit (feels good for arcade)
    this.rollAssist = rollAssist;

    // throttle impulses (mouse wheel adds bursts)
    this.throttleImpulse = 0;

    // bind handlers
    this._onKeyDown = this.handleKeyDown.bind(this);
    this._onKeyUp = this.handleKeyUp.bind(this);
    this._onPointerMove = this.handlePointerMove.bind(this);
    this._onPointerLeave = this.handlePointerLeave.bind(this);
    this._onWheel = this.handleWheel.bind(this);

    // listeners
    element.addEventListener('keydown', this._onKeyDown);
    element.addEventListener('keyup', this._onKeyUp);
    element.addEventListener('pointermove', this._onPointerMove);
    element.addEventListener('pointerleave', this._onPointerLeave);
    if (this.useMouseWheelThrottle) {
      element.addEventListener('wheel', this._onWheel, { passive: false });
    }
  }

  dispose() {
    if (!this.element) return;
    this.element.removeEventListener('keydown', this._onKeyDown);
    this.element.removeEventListener('keyup', this._onKeyUp);
    this.element.removeEventListener('pointermove', this._onPointerMove);
    this.element.removeEventListener('pointerleave', this._onPointerLeave);
    if (this.useMouseWheelThrottle) {
      this.element.removeEventListener('wheel', this._onWheel);
    }
    this.element = null;
  }

  handleKeyDown(event) {
    this.activeKeys.add(event.code);
    const preventDefault = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code);
    if (preventDefault) event.preventDefault();
  }

  handleKeyUp(event) {
    this.activeKeys.delete(event.code);
    const preventDefault = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code);
    if (preventDefault) event.preventDefault();
  }

  handlePointerMove(event) {
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

  handlePointerLeave() {
    this.pointerTarget.x = 0;
    this.pointerTarget.y = 0;
  }

  handleWheel(event) {
    if (!this.useMouseWheelThrottle) return;
    if (event.ctrlKey) return; // let browser zoom when ctrl is held
    event.preventDefault();
    // Scroll up => increase throttle (negative deltaY means wheel up)
    const delta = THREE.MathUtils.clamp(-event.deltaY * 0.05, -12, 12);
    this.throttleImpulse += delta;
  }

  readState(dt = 0) {
    // Smooth the pointer
    const blend = dt > 0 ? 1 - Math.exp(-this.pointerSmoothing * dt) : 1;
    this.pointer.x += (this.pointerTarget.x - this.pointer.x) * blend;
    this.pointer.y += (this.pointerTarget.y - this.pointer.y) * blend;

    // --- Digital axes ---
    const rollDigital = applyDeadzone(applyDigitalAxis(this.keyBindings.rollRight, this.keyBindings.rollLeft, this.activeKeys));

    // Optional keyboard pitch (e.g., W/S also pitch in addition to mouse)
    const pitchDigital = this.useKeyboardPitch
      ? applyDeadzone(applyDigitalAxis(this.keyBindings.pitchUp, this.keyBindings.pitchDown, this.activeKeys))
      : 0;

    // Keyboard throttle (continuous while held)
    const throttleDigital = this.useKeyboardThrottle
      ? applyDigitalAxis(this.keyBindings.throttleUp, this.keyBindings.throttleDown, this.activeKeys)
      : 0;

    // Consume mouse-wheel throttle impulses (burst per wheel event)
    const throttleImpulse = this.throttleImpulse;
    this.throttleImpulse = 0;

    const brake = (this.keyBindings.brake || []).some((key) => this.activeKeys.has(key));

    // --- Analog (pointer) contributions ---
    const yaw = applyDeadzone(this.pointer.x * this.pointerSensitivity.yaw);
    const pitchFromMouse = this.pointer.y * this.pointerSensitivity.pitch;

    const pitch = applyDeadzone(pitchFromMouse + pitchDigital);
    const roll = applyDeadzone(this.pointer.x * this.rollAssist + rollDigital);

    // Throttle adjust combines continuous digital + bursty wheel
    const throttleAdjust = throttleDigital + throttleImpulse;

    return { pitch, roll, yaw, throttleAdjust, brake };
  }
}

export function describeControls({ useMouseWheelThrottle = true, useKeyboardThrottle = true, useKeyboardPitch = false } = {}) {
  const lines = [
    { label: 'Aim', detail: 'Move mouse to steer nose (yaw/pitch)' },
    { label: 'Roll', detail: 'A banks left · D banks right' },
  ];

  if (useKeyboardPitch) {
    lines.push({ label: 'Pitch (keys)', detail: 'W climbs · S descends' });
  }

  if (useMouseWheelThrottle) {
    lines.push({ label: 'Throttle', detail: 'Mouse wheel to adjust thrust' });
  }

  if (useKeyboardThrottle) {
    lines.push({ label: 'Throttle (keys)', detail: 'Hold W to accelerate · S to decelerate' });
  }

  lines.push({ label: 'Brake', detail: 'Space for airbrake' });

  return lines;
}
