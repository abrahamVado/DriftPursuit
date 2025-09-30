import { TerraInputManager } from '../terra/InputManager.js';

const DEFAULT_SYSTEM_BINDINGS = Object.freeze({
  systemNextPlanet: ['BracketRight', 'Period'],
  systemPreviousPlanet: ['BracketLeft', 'Comma'],
  systemExitPlanet: ['KeyO'],
});

function mergeBindings(base, override){
  const result = { ...base };
  if (!override) return result;
  for (const [key, value] of Object.entries(override)){
    if (Array.isArray(value)){
      result[key] = value;
    }
  }
  return result;
}

export class CloudOfOrbsInputManager extends TerraInputManager {
  constructor({ keyBindings = {}, ...rest } = {}){
    const mergedBindings = mergeBindings(DEFAULT_SYSTEM_BINDINGS, keyBindings);
    super({ keyBindings: { ...mergedBindings, ...keyBindings }, ...rest });
    this.systemBindings = mergedBindings;
    this.pendingSystemCycle = 0;
    this.exitRequested = false;
    this.orbitalControlsEnabled = true;
    this.primaryPointerActive = false;
  }

  setOrbitalControlsEnabled(enabled){
    this.orbitalControlsEnabled = Boolean(enabled);
    if (!this.orbitalControlsEnabled){
      this.primaryPointerActive = false;
    }
  }

  handleKeyDown(event){
    super.handleKeyDown(event);
    if (this._matchesBinding(this.systemBindings.systemNextPlanet, event.code)){
      this.pendingSystemCycle += 1;
      event.preventDefault();
    } else if (this._matchesBinding(this.systemBindings.systemPreviousPlanet, event.code)){
      this.pendingSystemCycle -= 1;
      event.preventDefault();
    } else if (this._matchesBinding(this.systemBindings.systemExitPlanet, event.code)){
      this.exitRequested = true;
      event.preventDefault();
    }
  }

  handlePointerMove(event){
    if (this.orbitalControlsEnabled && (event.buttons & 1) === 1){
      this.cameraOrbitDelta.x += event.movementX ?? 0;
      this.cameraOrbitDelta.y += event.movementY ?? 0;
    }
    super.handlePointerMove(event);
  }

  handlePointerDown(event){
    if (this.orbitalControlsEnabled && event.button === 0){
      this.orbitActive = true;
      this.primaryPointerActive = true;
      event.preventDefault();
      return;
    }
    super.handlePointerDown(event);
  }

  handlePointerUp(event){
    if (this.orbitalControlsEnabled && event.button === 0){
      this.orbitActive = false;
      this.primaryPointerActive = false;
      event.preventDefault();
      return;
    }
    super.handlePointerUp(event);
  }

  handlePointerLeave(event){
    super.handlePointerLeave(event);
    if (this.orbitalControlsEnabled){
      this.primaryPointerActive = false;
    }
  }

  readState(dt){
    const zoomImpulse = this.throttleImpulse;
    const sample = super.readState(dt);
    const cycle = this.pendingSystemCycle;
    this.pendingSystemCycle = 0;
    const exitPlanet = this.exitRequested;
    this.exitRequested = false;
    sample.system = {
      zoomDelta: zoomImpulse,
      cycle,
      orbitActive: this.orbitActive,
      exitPlanet,
    };
    return sample;
  }

  _matchesBinding(binding, code){
    if (!Array.isArray(binding)) return false;
    return binding.includes(code);
  }
}

export default CloudOfOrbsInputManager;
