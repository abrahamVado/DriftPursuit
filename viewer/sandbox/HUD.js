const OVERLAY_STYLE = `
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-family: 'Segoe UI', 'Roboto', sans-serif;
  color: #f0f6ff;
  text-shadow: 0 0 8px rgba(0, 0, 0, 0.55);
`;

const CENTER_GROUP_STYLE = `
  position: absolute;
  top: 50%;
  left: 50%;
  width: 280px;
  height: 280px;
  transform: translate(-50%, -50%);
`;

const RETICLE_RING_STYLE = `
  position: absolute;
  top: 50%;
  left: 50%;
  width: 210px;
  height: 210px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.32);
  box-shadow: 0 0 36px rgba(0, 0, 0, 0.45) inset, 0 0 24px rgba(60, 150, 255, 0.25);
  backdrop-filter: blur(6px);
`;

const RETICLE_CORE_STYLE = `
  position: absolute;
  top: 50%;
  left: 50%;
  width: 46px;
  height: 46px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.55);
  box-shadow: 0 0 20px rgba(80, 180, 255, 0.35);
`;

const RETICLE_LINE_STYLE = `
  position: absolute;
  top: 50%;
  left: 50%;
  width: 210px;
  height: 2px;
  transform: translate(-50%, -50%);
  background: linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.7) 50%, rgba(255, 255, 255, 0) 100%);
`;

const RETICLE_LINE_VERTICAL_STYLE = `
  position: absolute;
  top: 50%;
  left: 50%;
  width: 2px;
  height: 210px;
  transform: translate(-50%, -50%);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.7) 50%, rgba(255, 255, 255, 0) 100%);
`;

const THROTTLE_RING_STYLE = `
  position: absolute;
  top: 50%;
  left: 50%;
  width: 230px;
  height: 230px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  filter: drop-shadow(0 0 18px rgba(0, 0, 0, 0.45));
  mask: radial-gradient(circle at center, transparent 64%, rgba(0, 0, 0, 0.85) 66%, rgba(0, 0, 0, 0.85) 100%);
  -webkit-mask: radial-gradient(circle at center, transparent 64%, rgba(0, 0, 0, 0.85) 66%, rgba(0, 0, 0, 0.85) 100%);
`;

const METRIC_STYLE = `
  position: absolute;
  padding: 10px 16px;
  background: rgba(12, 22, 42, 0.6);
  border-radius: 14px;
  backdrop-filter: blur(8px);
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.38);
  min-width: 136px;
  text-align: center;
`;

const METRIC_TITLE_STYLE = `
  font-size: 11px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  opacity: 0.72;
`;

const METRIC_VALUE_STYLE = `
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.04em;
  margin-top: 4px;
`;

const THROTTLE_TEXT_STYLE = `
  position: absolute;
  top: calc(50% + 72px);
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #9bfffc;
`;

const CONTROLS_PANEL_STYLE = `
  position: absolute;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 22px;
  border-radius: 14px;
  background: rgba(10, 20, 36, 0.64);
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(10px);
  font-size: 14px;
`;

const CONTROLS_TITLE_STYLE = `
  font-size: 12px;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  opacity: 0.68;
`;

const CONTROLS_ITEM_STYLE = `
  display: flex;
  gap: 6px;
  align-items: baseline;
`;

const MESSAGE_STYLE = `
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 18px 26px;
  font-size: 24px;
  font-weight: 700;
  color: #fff9f2;
  background: rgba(210, 60, 60, 0.85);
  border-radius: 14px;
  box-shadow: 0 22px 60px rgba(210, 60, 60, 0.45);
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const ACTION_BUTTON_STYLE = `
  position: absolute;
  bottom: 38px;
  right: 38px;
  padding: 12px 18px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(38, 58, 92, 0.92), rgba(64, 118, 184, 0.92));
  color: #f8fbff;
  border: 1px solid rgba(140, 190, 255, 0.45);
  font-size: 14px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.32);
  pointer-events: auto;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
`;

function createMetric(label){
  const wrapper = document.createElement('div');
  wrapper.setAttribute('style', METRIC_STYLE);

  const title = document.createElement('div');
  title.setAttribute('style', METRIC_TITLE_STYLE);
  title.textContent = label;

  const value = document.createElement('div');
  value.setAttribute('style', METRIC_VALUE_STYLE);
  value.textContent = '--';

  wrapper.appendChild(title);
  wrapper.appendChild(value);

  return { wrapper, value, title };
}

function formatTime(seconds){
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatDistance(meters){
  if (!Number.isFinite(meters) || meters <= 0) return '0 m';
  if (meters >= 1000){
    return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`;
  }
  return `${meters.toFixed(0)} m`;
}

export class HUD {
  constructor({ controls = {} } = {}){
    this.overlay = document.createElement('div');
    this.overlay.id = 'hud-overlay';
    this.overlay.setAttribute('style', OVERLAY_STYLE);
    document.body.appendChild(this.overlay);

    this.centerGroup = document.createElement('div');
    this.centerGroup.setAttribute('style', CENTER_GROUP_STYLE);
    this.overlay.appendChild(this.centerGroup);

    this.throttleRing = document.createElement('div');
    this.throttleRing.setAttribute('style', THROTTLE_RING_STYLE);
    this.centerGroup.appendChild(this.throttleRing);

    this.reticleRing = document.createElement('div');
    this.reticleRing.setAttribute('style', RETICLE_RING_STYLE);
    this.centerGroup.appendChild(this.reticleRing);

    const horizontal = document.createElement('div');
    horizontal.setAttribute('style', RETICLE_LINE_STYLE);
    const vertical = document.createElement('div');
    vertical.setAttribute('style', RETICLE_LINE_VERTICAL_STYLE);
    this.centerGroup.appendChild(horizontal);
    this.centerGroup.appendChild(vertical);

    this.reticleCore = document.createElement('div');
    this.reticleCore.setAttribute('style', RETICLE_CORE_STYLE);
    this.centerGroup.appendChild(this.reticleCore);

    this.throttleText = document.createElement('div');
    this.throttleText.setAttribute('style', THROTTLE_TEXT_STYLE);
    this.throttleLabel = controls.throttleLabel ?? 'THR';
    this.throttleText.textContent = `${this.throttleLabel} 0%`;
    this.centerGroup.appendChild(this.throttleText);

    this.metrics = {
      speed: createMetric('Speed'),
      crashes: createMetric('Crashes'),
      time: createMetric('Flight Time'),
      distance: createMetric('Distance'),
    };

    this.metrics.speed.wrapper.style.top = '-110px';
    this.metrics.speed.wrapper.style.left = '50%';
    this.metrics.speed.wrapper.style.transform = 'translate(-50%, 0)';

    this.metrics.time.wrapper.style.bottom = '-110px';
    this.metrics.time.wrapper.style.left = '50%';
    this.metrics.time.wrapper.style.transform = 'translate(-50%, 0)';

    this.metrics.distance.wrapper.style.top = '50%';
    this.metrics.distance.wrapper.style.left = '-120px';
    this.metrics.distance.wrapper.style.transform = 'translate(-100%, -50%)';

    this.metrics.crashes.wrapper.style.top = '50%';
    this.metrics.crashes.wrapper.style.right = '-120px';
    this.metrics.crashes.wrapper.style.transform = 'translate(100%, -50%)';

    Object.values(this.metrics).forEach(({ wrapper }) => {
      this.centerGroup.appendChild(wrapper);
    });

    this.controlsPanel = document.createElement('div');
    this.controlsPanel.id = 'hud-controls';
    this.controlsPanel.setAttribute('style', CONTROLS_PANEL_STYLE);

    this.controlsTitle = document.createElement('div');
    this.controlsTitle.setAttribute('style', CONTROLS_TITLE_STYLE);
    this.controlsTitle.textContent = controls.title ?? 'Controls';
    this.controlsPanel.appendChild(this.controlsTitle);

    this.controlsList = document.createElement('div');
    this.controlsList.style.display = 'grid';
    this.controlsList.style.gap = '4px';
    this.controlsPanel.appendChild(this.controlsList);
    this.overlay.appendChild(this.controlsPanel);

    this.message = document.createElement('div');
    this.message.id = 'crash-banner';
    this.message.setAttribute('style', MESSAGE_STYLE);
    this.message.style.display = 'none';
    this.overlay.appendChild(this.message);

    this.dropHandler = null;
    this.dropButton = document.createElement('button');
    this.dropButton.type = 'button';
    this.dropButton.textContent = 'Drop Vehicle';
    this.dropButton.setAttribute('style', `${ACTION_BUTTON_STYLE}`);
    this.dropButton.style.display = 'none';
    this.dropButton.addEventListener('click', () => {
      if (typeof this.dropHandler === 'function'){
        this.dropHandler();
      }
    });
    this.overlay.appendChild(this.dropButton);

    this.controls = Array.isArray(controls.items) ? controls.items : [];
    this.renderControls();
    this.setMetricLabels(controls.metricLabels ?? {});
    this.messageTimer = null;
  }

  update({ throttle = 0, speed = 0, crashCount = 0, elapsedTime = 0, distance = 0 }){
    const throttlePct = Math.round(Math.max(0, Math.min(1, throttle)) * 100);
    this.throttleText.textContent = `${this.throttleLabel} ${throttlePct}%`;
    const sweep = Math.max(0, Math.min(360, throttlePct * 3.6));
    const arcGradient = `conic-gradient(rgba(80, 255, 200, 0.8) ${sweep}deg, rgba(90, 120, 180, 0.18) ${sweep}deg 360deg)`;
    this.throttleRing.style.background = arcGradient;

    this.metrics.speed.value.textContent = `${speed.toFixed(0)} kt`;
    this.metrics.crashes.value.textContent = `${crashCount}`;
    this.metrics.time.value.textContent = formatTime(elapsedTime);
    this.metrics.distance.value.textContent = formatDistance(distance);
  }

  renderControls(){
    this.controlsList.innerHTML = '';
    this.controls.forEach((entry) => {
      const item = document.createElement('div');
      item.setAttribute('style', CONTROLS_ITEM_STYLE);
      const label = document.createElement('strong');
      label.textContent = entry.label;
      label.style.letterSpacing = '0.06em';
      label.style.textTransform = 'uppercase';
      label.style.fontSize = '12px';
      const detail = document.createElement('span');
      detail.textContent = entry.detail;
      detail.style.opacity = '0.85';
      item.appendChild(label);
      item.appendChild(detail);
      this.controlsList.appendChild(item);
    });
  }

  setControls(config = {}){
    if (config.title){
      this.controlsTitle.textContent = config.title;
    }
    if (Array.isArray(config.items)){
      this.controls = config.items;
      this.renderControls();
    }
    if (config.throttleLabel){
      this.throttleLabel = config.throttleLabel;
      this.throttleText.textContent = `${this.throttleLabel} 0%`;
    }
    if (config.metricLabels){
      this.setMetricLabels(config.metricLabels);
    }
  }

  setMetricLabels(labels = {}){
    if (labels.speed && this.metrics.speed?.title){
      this.metrics.speed.title.textContent = labels.speed;
    }
    if (labels.crashes && this.metrics.crashes?.title){
      this.metrics.crashes.title.textContent = labels.crashes;
    }
    if (labels.time && this.metrics.time?.title){
      this.metrics.time.title.textContent = labels.time;
    }
    if (labels.distance && this.metrics.distance?.title){
      this.metrics.distance.title.textContent = labels.distance;
    }
  }

  showMessage(text, durationMs = 1200){
    this.message.textContent = text;
    this.message.style.display = 'block';
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => {
      this.message.style.display = 'none';
    }, durationMs);
  }

  setDropHandler(handler){
    this.dropHandler = typeof handler === 'function' ? handler : null;
  }

  setDropEnabled(enabled){
    if (!this.dropButton) return;
    const visible = Boolean(enabled);
    this.dropButton.style.display = visible ? 'block' : 'none';
    this.dropButton.disabled = !visible;
  }
}
