import { requireTHREE } from '../shared/threeSetup.js';
import { PlanetSurfaceState } from './PlanetSurfaceManager.js';

const THREE = requireTHREE();

const DEFAULT_STATUS_TEXT = 'Select a match to engage autopilot routing.';

const MATCH_SECTION_STYLE = `
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 240px;
`;

const MATCH_LABEL_STYLE = `
  font-size: 12px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: rgba(190, 220, 255, 0.78);
`;

const MATCH_STATUS_STYLE = `
  font-size: 12px;
  line-height: 1.4;
  color: rgba(220, 240, 255, 0.82);
  min-height: 34px;
`;

const MATCH_GRID_STYLE = `
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
`;

const MATCH_BUTTON_STYLE = `
  position: relative;
  padding: 12px 16px;
  border-radius: 14px;
  border: 1px solid rgba(120, 200, 255, 0.28);
  background: rgba(18, 36, 62, 0.62);
  color: #e6f4ff;
  font-family: 'Rajdhani', 'Segoe UI', sans-serif;
  font-size: 13px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  cursor: pointer;
  transition: transform 140ms ease, border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
`;

const MATCH_BUTTON_ACTIVE_STYLE = `
  background: rgba(48, 96, 150, 0.82);
  border-color: rgba(150, 220, 255, 0.85);
  box-shadow: 0 16px 32px rgba(22, 54, 92, 0.55);
  transform: translateY(-3px);
`;

const MATCH_BUTTON_PAUSED_STYLE = `
  background: rgba(34, 52, 82, 0.58);
  border-color: rgba(130, 170, 210, 0.38);
`;

const MATCH_BUTTON_DISABLED_STYLE = `
  opacity: 0.58;
`;

const TMP_VECTOR = new THREE.Vector3();
const TMP_TARGET = new THREE.Vector3();
const TMP_DIRECTION = new THREE.Vector3();
const TMP_EULER = new THREE.Euler(0, 0, 0, 'ZXY');

function normalizeAngle(angle){
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function applyStyle(element, style){
  if (!element) return;
  if (element.__dpLastStyle === style) return;
  element.setAttribute('style', style);
  element.__dpLastStyle = style;
}

function toVector(point){
  if (!point) return new THREE.Vector3();
  if (point instanceof THREE.Vector3) return point.clone();
  if (Array.isArray(point)){
    return new THREE.Vector3(point[0] ?? 0, point[1] ?? 0, point[2] ?? 0);
  }
  const { x = 0, y = 0, z = 0 } = point;
  return new THREE.Vector3(x, y, z);
}

export class MatchManager {
  constructor({ presets = [], hud = null, surfaceManager = null } = {}){
    this.presets = Array.isArray(presets) ? presets.filter((entry) => entry && entry.id) : [];
    this.hud = hud ?? null;
    this.surfaceManager = surfaceManager ?? null;

    this.activeMatchId = null;
    this.currentWaypointIndex = 0;
    this.statusText = DEFAULT_STATUS_TEXT;
    this.paused = false;
    this.surfaceState = PlanetSurfaceState.SYSTEM_VIEW;

    this.section = null;
    this.statusElement = null;
    this.buttonGrid = null;
    this.buttons = new Map();

    this._buildUi();
    this._updateUi();
  }

  update(dt, { surfaceState = null, vehicleSystem = null } = {}){
    if (surfaceState){
      this.surfaceState = surfaceState;
    } else if (this.surfaceManager?.getState){
      this.surfaceState = this.surfaceManager.getState();
    }

    const preset = this._getActivePreset();
    if (!preset){
      this.statusText = DEFAULT_STATUS_TEXT;
      this.paused = false;
      this._updateUi();
      return null;
    }

    if (!vehicleSystem && this.surfaceManager?.vehicleSystem){
      vehicleSystem = this.surfaceManager.vehicleSystem;
    }

    if (this.surfaceState === PlanetSurfaceState.SYSTEM_VIEW){
      this.paused = true;
      this.statusText = `${preset.label}: autopilot paused in orbital view.`;
      this._updateUi();
      return null;
    }

    this.paused = false;

    if (!vehicleSystem){
      this.statusText = `${preset.label}: surface systems preparing…`;
      this._updateUi();
      return null;
    }

    const activeVehicle = vehicleSystem.getActiveVehicle?.();
    if (!activeVehicle){
      this.statusText = `${preset.label}: awaiting active vehicle…`;
      this._updateUi();
      return null;
    }

    if (activeVehicle.mode !== 'plane'){
      this.statusText = `${preset.label}: switching to aircraft mode…`;
      this._updateUi();
      return { modeRequest: 'plane', plane: null };
    }

    const vehicleState = vehicleSystem.getVehicleState?.(activeVehicle);
    if (!vehicleState){
      this.statusText = `${preset.label}: acquiring telemetry…`;
      this._updateUi();
      return null;
    }

    const result = this._computeAutopilot(vehicleState, preset);

    if (result.statusText){
      this.statusText = result.statusText;
    }

    this._updateUi();

    if (!result.input){
      if (activeVehicle.mode !== 'plane'){
        return { modeRequest: 'plane', plane: null };
      }
      return null;
    }

    const response = { plane: result.input };
    if (activeVehicle.mode !== 'plane'){
      response.modeRequest = 'plane';
    }
    return response;
  }

  setMatch(matchId){
    if (!matchId){
      this.clear();
      return;
    }
    if (this.activeMatchId === matchId){
      this.clear();
      return;
    }
    const preset = this.presets.find((entry) => entry.id === matchId);
    if (!preset){
      console.warn('[MatchManager] Unknown match id', matchId);
      return;
    }
    this.activeMatchId = preset.id;
    this.currentWaypointIndex = 0;
    this.statusText = `${preset.label} engaged. Aligning course…`;
    this._updateUi();
  }

  clear(){
    this.activeMatchId = null;
    this.currentWaypointIndex = 0;
    this.statusText = DEFAULT_STATUS_TEXT;
    this._updateUi();
  }

  handleSurfaceStateChange({ next } = {}){
    if (next) this.surfaceState = next;
    if (next === PlanetSurfaceState.SYSTEM_VIEW && this.activeMatchId){
      const preset = this._getActivePreset();
      this.statusText = preset
        ? `${preset.label}: autopilot paused in orbital view.`
        : DEFAULT_STATUS_TEXT;
      this.paused = true;
      this._updateUi();
    }
  }

  handleSurfaceReady(){
    if (!this.activeMatchId) return;
    const preset = this._getActivePreset();
    if (preset){
      this.statusText = `${preset.label}: ready for departure.`;
      this._updateUi();
    }
  }

  handleSurfaceDisposed(){
    if (this.activeMatchId){
      this.statusText = 'Surface reinitializing…';
      this._updateUi();
    }
  }

  _buildUi(){
    if (typeof document === 'undefined') return;
    const toolbar = this.hud?.toolbar || document.getElementById('terra-hud-toolbar');
    if (!toolbar){
      return;
    }

    this.section = document.createElement('div');
    applyStyle(this.section, MATCH_SECTION_STYLE);

    const label = document.createElement('div');
    applyStyle(label, MATCH_LABEL_STYLE);
    label.textContent = 'Match Presets';
    this.section.appendChild(label);

    this.statusElement = document.createElement('div');
    applyStyle(this.statusElement, MATCH_STATUS_STYLE);
    this.statusElement.textContent = DEFAULT_STATUS_TEXT;
    this.section.appendChild(this.statusElement);

    this.buttonGrid = document.createElement('div');
    applyStyle(this.buttonGrid, MATCH_GRID_STYLE);
    this.section.appendChild(this.buttonGrid);

    const fragment = document.createDocumentFragment();
    for (const preset of this.presets){
      if (!preset || !preset.id) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.matchId = preset.id;
      button.textContent = preset.label ?? preset.id;
      if (preset.description){
        button.title = preset.description;
      }
      applyStyle(button, MATCH_BUTTON_STYLE);
      button.addEventListener('click', () => {
        if (this.surfaceState === PlanetSurfaceState.SYSTEM_VIEW){
          this.statusText = 'Return to atmospheric flight to engage matches.';
          this._updateUi();
          return;
        }
        this.setMatch(preset.id);
      });
      this.buttons.set(preset.id, button);
      fragment.appendChild(button);
    }
    this.buttonGrid.appendChild(fragment);

    toolbar.appendChild(this.section);
    if (this.presets.length === 0){
      this.section.style.display = 'none';
    }
  }

  _updateUi(){
    if (!this.section) return;
    if (this.presets.length === 0){
      this.section.style.display = 'none';
      return;
    }
    this.section.style.display = '';
    if (this.statusElement && this.statusElement.textContent !== this.statusText){
      this.statusElement.textContent = this.statusText;
    }
    for (const [matchId, button] of this.buttons.entries()){
      const isActive = matchId === this.activeMatchId;
      let style = MATCH_BUTTON_STYLE;
      if (isActive){
        style += MATCH_BUTTON_ACTIVE_STYLE;
      } else if (this.paused){
        style += MATCH_BUTTON_PAUSED_STYLE;
      }
      if (this.surfaceState === PlanetSurfaceState.SYSTEM_VIEW){
        style += MATCH_BUTTON_DISABLED_STYLE;
      }
      button.disabled = false;
      applyStyle(button, style);
    }
  }

  _getActivePreset(){
    if (!this.activeMatchId) return null;
    return this.presets.find((entry) => entry.id === this.activeMatchId) ?? null;
  }

  _computeAutopilot(state, preset){
    if (!preset || !Array.isArray(preset.waypoints) || preset.waypoints.length === 0){
      return { input: null, statusText: 'No waypoints configured.' };
    }

    let waypoint = toVector(preset.waypoints[this.currentWaypointIndex % preset.waypoints.length]);
    if (!waypoint){
      return { input: null, statusText: `${preset.label}: invalid waypoint data.` };
    }

    const tolerance = Number.isFinite(preset.arrivalTolerance) ? preset.arrivalTolerance : 90;
    const position = state.position ?? TMP_VECTOR.set(0, 0, 0);

    TMP_TARGET.copy(waypoint).sub(position);
    let distance = TMP_TARGET.length();

    if (!Number.isFinite(distance)){
      distance = Number.POSITIVE_INFINITY;
    }

    if (distance <= Math.max(40, tolerance)){
      this._advanceWaypoint(preset);
      waypoint = toVector(preset.waypoints[this.currentWaypointIndex % preset.waypoints.length]);
      TMP_TARGET.copy(waypoint).sub(position);
      distance = TMP_TARGET.length();
    }

    if (!Number.isFinite(distance) || distance === 0){
      return { input: null, statusText: `${preset.label}: holding position.` };
    }

    const orientation = state.orientation ?? null;
    if (!orientation){
      return { input: null, statusText: `${preset.label}: awaiting orientation data…` };
    }

    TMP_EULER.setFromQuaternion(orientation, 'ZXY');
    const currentPitch = TMP_EULER.x;
    const currentRoll = TMP_EULER.y;
    const currentYaw = TMP_EULER.z;

    const direction = TMP_DIRECTION.copy(TMP_TARGET).normalize();
    const targetYaw = Math.atan2(direction.x, direction.y);
    const targetPitch = Math.asin(THREE.MathUtils.clamp(direction.z, -0.999, 0.999));

    const yawError = normalizeAngle(targetYaw - currentYaw);
    const pitchError = THREE.MathUtils.clamp(targetPitch - currentPitch, -Math.PI / 2, Math.PI / 2);
    const desiredRoll = THREE.MathUtils.clamp(yawError * 1.35, -THREE.MathUtils.degToRad(80), THREE.MathUtils.degToRad(80));
    const rollError = THREE.MathUtils.clamp(desiredRoll - currentRoll, -Math.PI, Math.PI);

    const yawCommand = THREE.MathUtils.clamp(yawError / THREE.MathUtils.degToRad(55), -1, 1);
    const pitchCommand = THREE.MathUtils.clamp(pitchError / THREE.MathUtils.degToRad(40), -1, 1);
    const rollCommand = THREE.MathUtils.clamp(rollError / THREE.MathUtils.degToRad(50), -1, 1);

    const altitudeError = waypoint.z - position.z;
    const currentThrottle = typeof state.throttle === 'number' ? state.throttle : 0.55;
    const throttleTarget = 0.6 + THREE.MathUtils.clamp(altitudeError / 6000, -0.3, 0.38);
    let throttleAdjust = THREE.MathUtils.clamp((throttleTarget - currentThrottle) * 1.2, -0.6, 0.6);

    if (distance < tolerance * 0.8){
      throttleAdjust = Math.min(throttleAdjust, -0.12);
    }

    const speed = typeof state.speed === 'number' ? state.speed : 0;
    const brake = distance < Math.max(90, tolerance * 0.6) && speed > 150;

    const statusText = `${preset.label}: waypoint ${this.currentWaypointIndex + 1}/${preset.waypoints.length} · ${Math.round(distance)}m`;

    return {
      input: {
        pitch: pitchCommand,
        yaw: yawCommand,
        roll: rollCommand,
        throttleAdjust,
        brake,
        aim: { x: THREE.MathUtils.clamp(yawCommand * 0.3, -1, 1), y: THREE.MathUtils.clamp(pitchCommand * 0.3, -1, 1) },
      },
      statusText,
    };
  }

  _advanceWaypoint(preset){
    if (!preset || !Array.isArray(preset.waypoints) || preset.waypoints.length === 0){
      this.currentWaypointIndex = 0;
      return;
    }
    const nextIndex = this.currentWaypointIndex + 1;
    if (nextIndex >= preset.waypoints.length){
      this.currentWaypointIndex = preset.loop ? 0 : preset.waypoints.length - 1;
    } else {
      this.currentWaypointIndex = nextIndex;
    }
  }
}

export default MatchManager;
