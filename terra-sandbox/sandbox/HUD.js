function createElement(tag, options = {}){
  const el = document.createElement(tag);
  if (options.className) el.className = options.className;
  if (options.text) el.textContent = options.text;
  return el;
}

function formatDistance(value){
  if (!Number.isFinite(value)) return '0 m';
  if (value >= 1000) return `${(value / 1000).toFixed(1)} km`;
  return `${Math.round(value)} m`;
}

function formatSpeed(value){
  if (!Number.isFinite(value)) return '0 u';
  return `${Math.round(value)} u`;
}

function formatTime(seconds){
  if (!Number.isFinite(seconds)) return '0:00';
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export class HUD {
  constructor({ controls = {} } = {}){
    this.overlay = createElement('div');
    this.overlay.id = 'terra-hud-overlay';
    this.overlay.style.position = 'absolute';
    this.overlay.style.inset = '0';
    this.overlay.style.pointerEvents = 'none';
    document.body.appendChild(this.overlay);

    this.centerGroup = createElement('div');
    this.centerGroup.id = 'terra-hud-center';
    this.overlay.appendChild(this.centerGroup);

    this.reticleRing = createElement('div');
    this.reticleRing.id = 'terra-hud-reticle-ring';
    this.centerGroup.appendChild(this.reticleRing);

    this.reticleCore = createElement('div');
    this.reticleCore.id = 'terra-hud-reticle-core';
    this.centerGroup.appendChild(this.reticleCore);

    this.reticleHorizontal = createElement('div');
    this.reticleHorizontal.id = 'terra-hud-reticle-horizontal';
    this.centerGroup.appendChild(this.reticleHorizontal);

    this.reticleVertical = createElement('div');
    this.reticleVertical.id = 'terra-hud-reticle-vertical';
    this.centerGroup.appendChild(this.reticleVertical);

    this.throttleRing = createElement('div');
    this.throttleRing.id = 'terra-hud-throttle-ring';
    this.centerGroup.appendChild(this.throttleRing);

    this.throttleText = createElement('div');
    this.throttleText.id = 'terra-hud-throttle-text';
    this.centerGroup.appendChild(this.throttleText);

    this.metricsContainer = createElement('div');
    this.metricsContainer.id = 'terra-hud-metrics';
    this.metricsContainer.style.position = 'absolute';
    this.metricsContainer.style.top = '32px';
    this.metricsContainer.style.right = '32px';
    this.metricsContainer.style.display = 'flex';
    this.metricsContainer.style.flexDirection = 'column';
    this.metricsContainer.style.gap = '12px';
    this.overlay.appendChild(this.metricsContainer);

    this.metrics = {
      speed: this._createMetric('Speed'),
      crashes: this._createMetric('Crashes'),
      time: this._createMetric('Uptime'),
      distance: this._createMetric('Distance'),
    };
    Object.values(this.metrics).forEach(({ wrapper }) => this.metricsContainer.appendChild(wrapper));

    this.controlsPanel = createElement('div');
    this.controlsPanel.id = 'terra-hud-controls';
    this.controlsPanel.style.position = 'absolute';
    this.controlsPanel.style.left = '32px';
    this.controlsPanel.style.bottom = '32px';
    this.controlsPanel.style.display = 'flex';
    this.controlsPanel.style.flexDirection = 'column';
    this.controlsPanel.style.gap = '8px';
    this.controlsPanel.style.pointerEvents = 'none';
    this.overlay.appendChild(this.controlsPanel);

    this.controlsTitle = createElement('div', { text: 'Controls' });
    this.controlsPanel.appendChild(this.controlsTitle);

    this.controlsList = createElement('ul');
    this.controlsList.style.listStyle = 'none';
    this.controlsList.style.margin = '0';
    this.controlsList.style.padding = '0';
    this.controlsPanel.appendChild(this.controlsList);

    this.message = createElement('div');
    this.message.id = 'terra-hud-message';
    this.message.style.display = 'none';
    this.message.style.pointerEvents = 'none';
    this.overlay.appendChild(this.message);

    this.messageTimer = null;
    this.throttleLabel = 'THR';
    this.setControls(controls);
  }

  _createMetric(title){
    const wrapper = createElement('div');
    const label = createElement('div', { text: title });
    label.className = 'terra-hud-metric-title';
    const value = createElement('div', { text: '0' });
    value.className = 'terra-hud-metric-value';
    wrapper.appendChild(label);
    wrapper.appendChild(value);
    return { wrapper, title: label, value };
  }

  setControls({ title = 'Controls', items = [], metricLabels = {}, throttleLabel = this.throttleLabel } = {}){
    this.controlsTitle.textContent = title;
    this.throttleLabel = throttleLabel ?? this.throttleLabel;

    while (this.controlsList.firstChild){
      this.controlsList.removeChild(this.controlsList.firstChild);
    }
    items.forEach((item) => {
      if (!item) return;
      const entry = createElement('li');
      entry.textContent = item.detail ? `${item.label}: ${item.detail}` : item.label;
      this.controlsList.appendChild(entry);
    });

    if (metricLabels.speed && this.metrics.speed){ this.metrics.speed.title.textContent = metricLabels.speed; }
    if (metricLabels.crashes && this.metrics.crashes){ this.metrics.crashes.title.textContent = metricLabels.crashes; }
    if (metricLabels.time && this.metrics.time){ this.metrics.time.title.textContent = metricLabels.time; }
    if (metricLabels.distance && this.metrics.distance){ this.metrics.distance.title.textContent = metricLabels.distance; }
    if (this.throttleText){
      this.throttleText.textContent = this.throttleLabel;
    }
  }

  showMessage(message, { duration = 2500 } = {}){
    if (!this.message) return;
    if (!message){
      this.message.style.display = 'none';
      this.message.textContent = '';
      if (this.messageTimer){
        clearTimeout(this.messageTimer);
        this.messageTimer = null;
      }
      return;
    }
    this.message.textContent = message;
    this.message.style.display = 'block';
    if (this.messageTimer){
      clearTimeout(this.messageTimer);
    }
    this.messageTimer = setTimeout(() => {
      this.message.style.display = 'none';
      this.message.textContent = '';
      this.messageTimer = null;
    }, duration);
  }

  update({ speed = 0, crashCount = 0, elapsedTime = 0, distance = 0, throttle = 0 } = {}){
    if (this.metrics.speed){
      this.metrics.speed.value.textContent = formatSpeed(speed);
    }
    if (this.metrics.crashes){
      this.metrics.crashes.value.textContent = String(crashCount ?? 0);
    }
    if (this.metrics.time){
      this.metrics.time.value.textContent = formatTime(elapsedTime);
    }
    if (this.metrics.distance){
      this.metrics.distance.value.textContent = formatDistance(distance);
    }
    if (this.throttleText){
      const pct = Math.round(clamp01(throttle) * 100);
      this.throttleText.textContent = `${this.throttleLabel} ${pct}%`;
    }
  }
}

function clamp01(value){
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
