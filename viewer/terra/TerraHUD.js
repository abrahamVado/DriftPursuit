import { HUD as BaseHUD } from '../sandbox/HUD.js';

const OVERLAY_STYLE = `
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-family: 'Rajdhani', 'Segoe UI', sans-serif;
  color: #eef6ff;
  text-shadow: 0 0 22px rgba(7, 24, 44, 0.7);
  z-index: 2;
`;

const CENTER_GROUP_STYLE = `
  position: absolute;
  top: 50%;
  left: 50%;
  width: 320px;
  height: 320px;
  transform: translate(-50%, -50%);
`;

const RETICLE_RING_STYLE = `
  position: absolute;
  top: 50%;
  left: 50%;
  width: 240px;
  height: 240px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 2px solid rgba(160, 210, 255, 0.4);
  box-shadow: 0 0 34px rgba(10, 40, 80, 0.35) inset, 0 0 32px rgba(125, 200, 255, 0.35);
  backdrop-filter: blur(9px);
`;

const RETICLE_CORE_STYLE = `
  position: absolute;
  top: 50%;
  left: 50%;
  width: 52px;
  height: 52px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.65);
  box-shadow: 0 0 26px rgba(140, 220, 255, 0.55);
  background: radial-gradient(circle, rgba(140, 220, 255, 0.25) 0%, rgba(10, 40, 68, 0.6) 75%);
`;

const RETICLE_LINE_STYLE = `
  position: absolute;
  top: 50%;
  left: 50%;
  width: 240px;
  height: 2px;
  transform: translate(-50%, -50%);
  background: linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(200, 240, 255, 0.9) 50%, rgba(255, 255, 255, 0) 100%);
`;

const RETICLE_LINE_VERTICAL_STYLE = `
  position: absolute;
  top: 50%;
  left: 50%;
  width: 2px;
  height: 240px;
  transform: translate(-50%, -50%);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0) 0%, rgba(200, 240, 255, 0.9) 50%, rgba(255, 255, 255, 0) 100%);
`;

const THROTTLE_RING_STYLE = `
  position: absolute;
  top: 50%;
  left: 50%;
  width: 260px;
  height: 260px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  filter: drop-shadow(0 0 22px rgba(12, 34, 58, 0.6));
  mask: radial-gradient(circle at center, transparent 64%, rgba(0, 0, 0, 0.8) 68%, rgba(0, 0, 0, 0.8) 100%);
  -webkit-mask: radial-gradient(circle at center, transparent 64%, rgba(0, 0, 0, 0.8) 68%, rgba(0, 0, 0, 0.8) 100%);
`;

const THROTTLE_TEXT_STYLE = `
  position: absolute;
  top: calc(50% + 82px);
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: #7ef9ff;
`;

const METRIC_STYLE = `
  position: absolute;
  padding: 14px 18px;
  background: linear-gradient(180deg, rgba(16, 36, 68, 0.62) 0%, rgba(8, 18, 32, 0.88) 100%);
  border-radius: 18px;
  border: 1px solid rgba(122, 200, 255, 0.28);
  box-shadow: 0 18px 48px rgba(4, 10, 24, 0.65);
  backdrop-filter: blur(14px);
  min-width: 148px;
  text-align: center;
`;

const METRIC_TITLE_STYLE = `
  font-size: 11px;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: rgba(190, 220, 255, 0.85);
`;

const METRIC_VALUE_STYLE = `
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin-top: 6px;
  color: #ffffff;
`;

const CONTROLS_PANEL_STYLE = `
  position: absolute;
  bottom: 36px;
  left: 40px;
  display: inline-flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px 24px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(14, 32, 58, 0.78) 0%, rgba(8, 18, 32, 0.92) 100%);
  box-shadow: 0 24px 52px rgba(6, 12, 26, 0.65);
  backdrop-filter: blur(12px);
  font-size: 14px;
  pointer-events: none;
`;

const CONTROLS_TITLE_STYLE = `
  font-size: 12px;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: rgba(170, 210, 255, 0.86);
`;

const MESSAGE_STYLE = `
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 20px 34px;
  font-size: 26px;
  font-weight: 700;
  color: #ffffff;
  background: linear-gradient(90deg, rgba(220, 68, 88, 0.9) 0%, rgba(220, 118, 96, 0.85) 100%);
  border-radius: 18px;
  box-shadow: 0 28px 64px rgba(200, 60, 60, 0.55);
  letter-spacing: 0.12em;
  text-transform: uppercase;
`;

const TOOLBAR_STYLE = `
  position: absolute;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  display: flex;
  gap: 12px;
  padding: 16px 22px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(10, 24, 42, 0.82) 0%, rgba(6, 14, 26, 0.94) 100%);
  border: 1px solid rgba(112, 188, 255, 0.35);
  box-shadow: 0 26px 60px rgba(5, 12, 26, 0.72);
  backdrop-filter: blur(12px);
  pointer-events: auto;
  z-index: 4;
`;

const AMMO_BUTTON_STYLE = `
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 12px 16px;
  min-width: 160px;
  border-radius: 14px;
  border: 1px solid rgba(120, 200, 255, 0.25);
  background: rgba(18, 36, 62, 0.65);
  color: #e9f6ff;
  font-family: 'Rajdhani', 'Segoe UI', sans-serif;
  text-align: left;
  cursor: pointer;
  transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
`;

const AMMO_BUTTON_ACTIVE_STYLE = `
  background: rgba(40, 88, 140, 0.78);
  border-color: rgba(140, 220, 255, 0.85);
  box-shadow: 0 12px 28px rgba(26, 80, 140, 0.45);
  transform: translateY(-3px);
`;

const AMMO_NAME_STYLE = `
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
`;

const AMMO_EFFECT_STYLE = `
  font-size: 13px;
  color: rgba(210, 230, 255, 0.86);
`;

function applyStyle(element, style){
  element.setAttribute('style', style);
}

function isElement(node){
  return typeof HTMLElement !== 'undefined' && node instanceof HTMLElement;
}

export class TerraHUD extends BaseHUD {
  constructor({ controls = {}, ammoOptions = [], onAmmoSelect = null } = {}){
    super({ controls });
    this.onAmmoSelect = onAmmoSelect;
    this.selectedAmmoId = null;
    this.ammoButtons = new Map();

    this._applyTheme();
    this._createToolbar();
    this.setAmmoOptions(ammoOptions);
  }

  _applyTheme(){
    applyStyle(this.overlay, OVERLAY_STYLE);
    applyStyle(this.centerGroup, CENTER_GROUP_STYLE);
    applyStyle(this.reticleRing, RETICLE_RING_STYLE);
    applyStyle(this.reticleCore, RETICLE_CORE_STYLE);
    applyStyle(this.throttleRing, THROTTLE_RING_STYLE);
    applyStyle(this.throttleText, THROTTLE_TEXT_STYLE);

    Array.from(this.centerGroup.children).forEach((node) => {
      if (!isElement(node)) return;
      if (node.style?.height === '2px'){
        applyStyle(node, RETICLE_LINE_STYLE);
      } else if (node.style?.width === '2px'){
        applyStyle(node, RETICLE_LINE_VERTICAL_STYLE);
      }
    });

    Object.values(this.metrics).forEach(({ wrapper, title, value }) => {
      applyStyle(wrapper, METRIC_STYLE);
      applyStyle(title, METRIC_TITLE_STYLE);
      applyStyle(value, METRIC_VALUE_STYLE);
    });

    applyStyle(this.controlsPanel, CONTROLS_PANEL_STYLE);
    applyStyle(this.controlsTitle, CONTROLS_TITLE_STYLE);
    applyStyle(this.message, MESSAGE_STYLE);
  }

  _createToolbar(){
    this.toolbar = document.createElement('div');
    this.toolbar.id = 'terra-hud-toolbar';
    applyStyle(this.toolbar, TOOLBAR_STYLE);
    document.body.appendChild(this.toolbar);
  }

  setAmmoOptions(options = []){
    this.ammoButtons.clear();
    this.toolbar.innerHTML = '';
    options.forEach((option, index) => {
      if (!option || !option.id) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.ammoId = option.id;
      applyStyle(button, AMMO_BUTTON_STYLE);

      const name = document.createElement('div');
      applyStyle(name, AMMO_NAME_STYLE);
      name.textContent = option.name ?? option.id;

      const effect = document.createElement('div');
      applyStyle(effect, AMMO_EFFECT_STYLE);
      effect.textContent = option.effect ?? '';

      button.appendChild(name);
      button.appendChild(effect);
      button.addEventListener('click', () => {
        this._selectAmmo(option.id, false);
      });

      this.toolbar.appendChild(button);
      this.ammoButtons.set(option.id, button);

      if (index === 0 && !this.selectedAmmoId){
        this._selectAmmo(option.id, true);
      }
    });
  }

  setActiveAmmo(id){
    this._selectAmmo(id, true);
  }

  _selectAmmo(id, silent){
    if (!id || !this.ammoButtons.has(id)){
      return;
    }
    if (this.selectedAmmoId === id){
      if (!silent && typeof this.onAmmoSelect === 'function'){
        this.onAmmoSelect(id);
      }
      return;
    }
    this.selectedAmmoId = id;
    this.ammoButtons.forEach((button, ammoId) => {
      const active = ammoId === id;
      const style = `${AMMO_BUTTON_STYLE}${active ? AMMO_BUTTON_ACTIVE_STYLE : ''}`;
      applyStyle(button, style);
    });
    if (!silent && typeof this.onAmmoSelect === 'function'){
      this.onAmmoSelect(id);
    }
  }
}
