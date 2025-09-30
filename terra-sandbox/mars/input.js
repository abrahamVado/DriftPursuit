function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const DEFAULT_SENSITIVITY = 0.0028;

export class MarsInputManager {
  constructor({ canvas, sensitivity = DEFAULT_SENSITIVITY } = {}) {
    this.canvas = canvas;
    this.sensitivity = sensitivity;
    this.keys = new Set();
    this._pressed = new Set();
    this.pointerLocked = false;
    this.primaryFire = false;
    this.aimX = 0;
    this.aimY = 0;
    this._listeners = [];

    this._handleKeyDown = this._handleKeyDown.bind(this);
    this._handleKeyUp = this._handleKeyUp.bind(this);
    this._handlePointerDown = this._handlePointerDown.bind(this);
    this._handlePointerUp = this._handlePointerUp.bind(this);
    this._handleMouseMove = this._handleMouseMove.bind(this);
    this._handlePointerLockChange = this._handlePointerLockChange.bind(this);
    this._handleVisibilityChange = this._handleVisibilityChange.bind(this);

    document.addEventListener('keydown', this._handleKeyDown);
    document.addEventListener('keyup', this._handleKeyUp);
    document.addEventListener('pointerlockchange', this._handlePointerLockChange);
    document.addEventListener('visibilitychange', this._handleVisibilityChange);
    document.addEventListener('mouseup', this._handlePointerUp);

    if (this.canvas) {
      this.canvas.addEventListener('click', () => {
        if (!this.pointerLocked && this.canvas.requestPointerLock) {
          this.canvas.requestPointerLock();
        }
      });
      this.canvas.addEventListener('mousedown', this._handlePointerDown);
    }
  }

  dispose() {
    document.removeEventListener('keydown', this._handleKeyDown);
    document.removeEventListener('keyup', this._handleKeyUp);
    document.removeEventListener('pointerlockchange', this._handlePointerLockChange);
    document.removeEventListener('visibilitychange', this._handleVisibilityChange);
    document.removeEventListener('mouseup', this._handlePointerUp);
    document.removeEventListener('mousemove', this._handleMouseMove);
    if (this.canvas) {
      this.canvas.removeEventListener('mousedown', this._handlePointerDown);
    }
  }

  _handleKeyDown(event) {
    this.keys.add(event.code);
    if (!event.repeat) {
      this._pressed.add(event.code);
    }
  }

  _handleKeyUp(event) {
    this.keys.delete(event.code);
    this._pressed.delete(event.code);
  }

  _handlePointerDown(event) {
    if (event.button === 0) {
      this.primaryFire = true;
    }
  }

  _handlePointerUp(event) {
    if (event.button === 0) {
      this.primaryFire = false;
    }
  }

  _handleMouseMove(event) {
    if (!this.pointerLocked) return;
    const movementX = event.movementX || 0;
    const movementY = event.movementY || 0;
    this.aimX = clamp(this.aimX + movementX * this.sensitivity, -1, 1);
    this.aimY = clamp(this.aimY + movementY * this.sensitivity, -1, 1);
  }

  _handlePointerLockChange() {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    if (this.pointerLocked) {
      document.addEventListener('mousemove', this._handleMouseMove);
    } else {
      document.removeEventListener('mousemove', this._handleMouseMove);
      this.aimX = 0;
      this.aimY = 0;
      this.primaryFire = false;
    }
  }

  _handleVisibilityChange() {
    if (document.hidden) {
      this.keys.clear();
      this._pressed.clear();
      this.primaryFire = false;
    }
  }

  update(dt) {
    const decay = dt > 0 ? Math.exp(-1.5 * dt) : 0;
    if (!this.pointerLocked) {
      this.aimX *= decay;
      this.aimY *= decay;
    } else {
      this.aimX = clamp(this.aimX, -1, 1);
      this.aimY = clamp(this.aimY, -1, 1);
    }
  }

  _axis(positive, negative) {
    const hasPositive = Array.isArray(positive)
      ? positive.some((code) => this.keys.has(code))
      : this.keys.has(positive);
    const hasNegative = Array.isArray(negative)
      ? negative.some((code) => this.keys.has(code))
      : this.keys.has(negative);
    if (hasPositive && !hasNegative) return 1;
    if (hasNegative && !hasPositive) return -1;
    return 0;
  }

  _consumePressed(codes) {
    if (!Array.isArray(codes)) {
      codes = [codes];
    }
    let triggered = false;
    for (const code of codes) {
      if (this._pressed.has(code)) {
        this._pressed.delete(code);
        triggered = true;
      }
    }
    return triggered;
  }

  getState() {
    const throttleAdjust = this._axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']);
    return {
      throttleAdjust,
      throttle: throttleAdjust,
      yaw: this._axis('KeyD', 'KeyA'),
      roll: this._axis('KeyE', 'KeyQ'),
      pitch: this._axis('ArrowDown', 'ArrowUp'),
      boost: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      brake: this.keys.has('Space'),
      aim: { x: this.aimX, y: this.aimY },
      firing: this.primaryFire,
      toggleNavigationLights: this._consumePressed(['KeyN', 'KeyV']),
      toggleAuxiliaryLights: this._consumePressed('KeyL'),
    };
  }
}
