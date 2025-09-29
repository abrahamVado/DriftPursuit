const PANEL_STYLE = `
  position: absolute;
  top: 16px;
  left: 16px;
  padding: 16px 20px;
  background: rgba(18, 30, 52, 0.6);
  color: #e8f1ff;
  font-family: 'Segoe UI', sans-serif;
  border-radius: 12px;
  min-width: 260px;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(10px);
`;

const MESSAGE_STYLE = `
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 18px 24px;
  font-size: 24px;
  font-weight: 700;
  color: #fff9f2;
  background: rgba(210, 60, 60, 0.82);
  border-radius: 12px;
  box-shadow: 0 22px 60px rgba(210, 60, 60, 0.45);
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

const LIST_STYLE = `
  list-style: none;
  padding: 0;
  margin: 12px 0 0;
  display: grid;
  gap: 6px;
`;

export class HUD {
  constructor({ controls = [] } = {}){
    this.container = document.createElement('div');
    this.container.id = 'hud-panel';
    this.container.setAttribute('style', PANEL_STYLE);

    this.status = document.createElement('div');
    this.status.style.fontSize = '14px';
    this.status.style.letterSpacing = '0.06em';
    this.status.style.textTransform = 'uppercase';
    this.status.style.marginBottom = '10px';
    this.status.textContent = 'Initializing flight systems…';

    this.metrics = document.createElement('div');
    this.metrics.style.display = 'grid';
    this.metrics.style.gap = '4px';
    this.metrics.style.fontSize = '15px';
    this.metrics.style.fontWeight = '600';

    this.throttleBar = document.createElement('div');
    this.throttleBar.style.height = '6px';
    this.throttleBar.style.background = 'rgba(255,255,255,0.2)';
    this.throttleBar.style.borderRadius = '999px';
    this.throttleFill = document.createElement('div');
    this.throttleFill.style.height = '100%';
    this.throttleFill.style.background = 'linear-gradient(90deg, #51d7ff, #5bff90)';
    this.throttleFill.style.borderRadius = 'inherit';
    this.throttleFill.style.width = '0%';
    this.throttleBar.appendChild(this.throttleFill);

    this.controlsTitle = document.createElement('div');
    this.controlsTitle.textContent = 'Flight Controls';
    this.controlsTitle.style.marginTop = '14px';
    this.controlsTitle.style.fontSize = '13px';
    this.controlsTitle.style.letterSpacing = '0.12em';
    this.controlsTitle.style.textTransform = 'uppercase';
    this.controlsTitle.style.opacity = '0.8';

    this.controlsList = document.createElement('ul');
    this.controlsList.setAttribute('style', LIST_STYLE);
    this.controlsList.style.fontSize = '14px';
    this.controlsList.style.opacity = '0.92';

    this.container.appendChild(this.status);
    this.container.appendChild(this.metrics);
    this.container.appendChild(this.throttleBar);
    this.container.appendChild(this.controlsTitle);
    this.container.appendChild(this.controlsList);

    document.body.appendChild(this.container);

    this.message = document.createElement('div');
    this.message.id = 'crash-banner';
    this.message.setAttribute('style', MESSAGE_STYLE);
    this.message.style.display = 'none';
    document.body.appendChild(this.message);

    this.controls = controls;
    this.renderControls();
    this.messageTimer = null;
  }

  update({ throttle = 0, speed = 0, altitude = 0, crashCount = 0 }){
    this.status.textContent = `Throttle ${(throttle * 100).toFixed(0)}% · Speed ${speed.toFixed(0)} kt`;
    this.metrics.innerHTML = `
      <div>Altitude <strong>${altitude.toFixed(0)} m</strong></div>
      <div>Crash Count <strong>${crashCount}</strong></div>
    `;
    this.throttleFill.style.width = `${Math.max(4, Math.min(100, throttle * 100))}%`;
  }

  renderControls(){
    this.controlsList.innerHTML = '';
    this.controls.forEach((entry) => {
      const item = document.createElement('li');
      item.innerHTML = `<strong>${entry.label}</strong>: ${entry.detail}`;
      this.controlsList.appendChild(item);
    });
  }

  setControls(controls){
    this.controls = Array.isArray(controls) ? controls : [];
    this.renderControls();
  }

  showMessage(text, durationMs = 1200){
    this.message.textContent = text;
    this.message.style.display = 'block';
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => {
      this.message.style.display = 'none';
    }, durationMs);
  }
}
