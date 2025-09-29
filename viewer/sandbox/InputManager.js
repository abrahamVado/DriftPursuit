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
  throttleUp: [],
  throttleDown: [],
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
    useKeyboardThrottle = false,
    useKeyboardPitch = false,
    pointerSmoothing = 9,
    pointerSensitivity = { yaw: 0.9, pitch: 0.8 },
    rollAssist = 0.55,
    keyBindings = {},
    cameraOrbitSensitivity = { yaw: 0.0032, pitch: 0.0026 },
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

    // camera orbit
    this.cameraOrbitSensitivity = {
      yaw: cameraOrbitSensitivity.yaw ?? 0.0032,
      pitch: cameraOrbitSensitivity.pitch ?? 0.0026,
    };
    this.cameraOrbitDelta = { x: 0, y: 0 };
    this.pointerDown = false;
    this.lastButtons = 0;

    // bind handlers
    this._onKeyDown = this.handleKeyDown.bind(this);
    this._onKeyUp = this.handleKeyUp.bind(this);
    this._onPointerMove = this.handlePointerMove.bind(this);
    this._onPointerLeave = this.handlePointerLeave.bind(this);
    this._onPointerDown = this.handlePointerDown.bind(this);
    this._onPointerUp = this.handlePointerUp.bind(this);
    this._onWheel = this.handleWheel.bind(this);

    // listeners
    element.addEventListener('keydown', this._onKeyDown);
    element.addEventListener('keyup', this._onKeyUp);
    element.addEventListener('pointermove', this._onPointerMove);
    element.addEventListener('pointerleave', this._onPointerLeave);
    element.addEventListener('pointerdown', this._onPointerDown);
    element.addEventListener('pointerup', this._onPointerUp);
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
    this.element.removeEventListener('pointerdown', this._onPointerDown);
    this.element.removeEventListener('pointerup', this._onPointerUp);
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

    const movementX = event.movementX ?? event.mozMovementX ?? event.webkitMovementX ?? 0;
    const movementY = event.movementY ?? event.mozMovementY ?? event.webkitMovementY ?? 0;
    const buttons = event.buttons ?? this.lastButtons;
    if ((buttons & 1) === 1) {
      this.cameraOrbitDelta.x += movementX;
      this.cameraOrbitDelta.y += movementY;
    }
    this.lastButtons = buttons;
  }

  handlePointerLeave() {
    this.pointerTarget.x = 0;
    this.pointerTarget.y = 0;
    this.pointerDown = false;
  }

  handlePointerDown(event) {
    if (event.button === 0) {
      this.pointerDown = true;
    }
  }

  handlePointerUp(event) {
    if (event.button === 0) {
      this.pointerDown = false;
    }
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
    const yawDigital = applyDeadzone(applyDigitalAxis(this.keyBindings.rollRight, this.keyBindings.rollLeft, this.activeKeys));

    const pitchDigital = applyDeadzone(applyDigitalAxis(this.keyBindings.pitchUp, this.keyBindings.pitchDown, this.activeKeys));

    // Keyboard throttle (continuous while held)
    const throttleDigital = this.useKeyboardThrottle
      ? applyDigitalAxis(this.keyBindings.throttleUp, this.keyBindings.throttleDown, this.activeKeys)
      : 0;

    // Consume mouse-wheel throttle impulses (burst per wheel event)
    const throttleImpulse = this.throttleImpulse;
    this.throttleImpulse = 0;

    const brake = (this.keyBindings.brake || []).some((key) => this.activeKeys.has(key));

    // --- Analog (pointer) contributions ---
    const pointerYaw = applyDeadzone(this.pointer.x * this.pointerSensitivity.yaw);
    const pointerPitch = this.pointer.y * this.pointerSensitivity.pitch;

    // Plane controls rely on keyboard by default. Pointer remains available for other systems.
    const pitch = applyDeadzone((this.useKeyboardPitch ? pointerPitch : 0) + pitchDigital);
    const roll = yawDigital;
    const yaw = yawDigital;
    const planeAim = {
      x: applyDeadzone(this.pointer.x),
      y: applyDeadzone(this.pointer.y),
      yawAnalog: pointerYaw,
      pitchAnalog: pointerPitch,
    };

    // Throttle adjust combines continuous digital + bursty wheel
    const throttleAdjust = throttleDigital + throttleImpulse;

    const cameraOrbit = {
      yawDelta: this.cameraOrbitDelta.x * this.cameraOrbitSensitivity.yaw,
      pitchDelta: this.cameraOrbitDelta.y * this.cameraOrbitSensitivity.pitch,
      active: this.pointerDown,
    };
    this.cameraOrbitDelta.x = 0;
    this.cameraOrbitDelta.y = 0;

    return {
      plane: { pitch, roll, yaw, throttleAdjust, brake, aim: planeAim },
      car: {
        throttle: pitchDigital,
        steer: yawDigital,
        brake,
        aim: { x: this.pointer.x, y: this.pointer.y },
      },
      cameraOrbit,
    };
  }
}

export function describeControls(mode = 'plane') {
  if (mode === 'car') {
    return {
      title: 'Drive Controls',
      throttleLabel: 'PWR',
      metricLabels: { time: 'Drive Time', distance: 'Distance', speed: 'Speed', crashes: 'Crashes' },
      items: [
        { label: 'Drive', detail: 'W accelerate · S reverse' },
        { label: 'Steer', detail: 'A turn left · D turn right' },
        { label: 'Brake', detail: 'Space for handbrake' },
        { label: 'Stick', detail: 'Move mouse to sway tower' },
        { label: 'Camera', detail: 'Hold Left Mouse to orbit view' },
        { label: 'Mode', detail: 'Press 1 for plane · 2 for car' },
      ],
    };
  }

  return {
    title: 'Flight Controls',
    throttleLabel: 'THR',
    metricLabels: { time: 'Flight Time', distance: 'Distance', speed: 'Speed', crashes: 'Crashes' },
    items: [
      { label: 'Pitch', detail: 'W climbs · S dives' },
      { label: 'Turn', detail: 'A yaw & roll left · D yaw & roll right' },
      { label: 'Throttle', detail: 'Mouse wheel to adjust thrust' },
      { label: 'Brake', detail: 'Space for airbrake' },
      { label: 'Camera', detail: 'Hold Left Mouse to orbit view' },
      { label: 'Mode', detail: 'Press 1 for plane · 2 for car' },
    ],
  };
}
