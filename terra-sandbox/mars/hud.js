function formatNumber(value, digits = 0) {
  return value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function hexToRgba(hex, alpha = 1) {
  if (!hex) return `rgba(255,255,255,${alpha})`;
  const normalized = hex.replace('#', '');
  const value = parseInt(normalized, 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export class MarsHUD {
  constructor({
    statusLabel,
    altitudeOutput,
    temperatureOutput,
    windOutput,
    speedOutput,
    throttleOutput,
    weaponOutput,
    seedOutput,
    minimapCanvas,
    beaconList,
  }) {
    this.statusLabel = statusLabel;
    this.altitudeOutput = altitudeOutput;
    this.temperatureOutput = temperatureOutput;
    this.windOutput = windOutput;
    this.speedOutput = speedOutput;
    this.throttleOutput = throttleOutput;
    this.weaponOutput = weaponOutput;
    this.seedOutput = seedOutput;
    this.minimapCanvas = minimapCanvas || null;
    this.minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;
    this.beaconList = beaconList || null;
    this._lastBeaconSummary = '';
  }

  setStatus(text) {
    if (this.statusLabel) {
      this.statusLabel.textContent = text;
    }
  }

  setSeed(seed) {
    if (this.seedOutput) {
      this.seedOutput.textContent = seed;
    }
  }

  updateEnvironment({ temperature, wind } = {}) {
    if (this.temperatureOutput && typeof temperature === 'number') {
      this.temperatureOutput.textContent = `${Math.round(temperature)} °C`;
    }
    if (this.windOutput && typeof wind === 'number') {
      this.windOutput.textContent = `${Math.round(wind)} m/s`;
    }
  }

  updateVehicle({ altitude, speed, throttle, boost, weaponReady, heat } = {}) {
    if (this.altitudeOutput && typeof altitude === 'number') {
      this.altitudeOutput.textContent = formatNumber(Math.max(0, altitude));
    }
    if (this.speedOutput && typeof speed === 'number') {
      this.speedOutput.textContent = `${formatNumber(Math.max(0, speed), 0)} km/h`;
    }
    if (this.throttleOutput && typeof throttle === 'number') {
      const boostSuffix = boost ? ' +BOOST' : '';
      this.throttleOutput.textContent = `${Math.round(throttle * 100)}%${boostSuffix}`;
    }
    if (this.weaponOutput) {
      if (!weaponReady) {
        this.weaponOutput.textContent = `Cooling (${Math.round(Math.max(0, heat) * 100)}%)`;
      } else {
        this.weaponOutput.textContent = 'Ready';
      }
    }
  }

  updateNavigation({ vehiclePosition, beacons = [], exploredChunks = [], chunkSize = 16 } = {}) {
    if (this.minimapCtx && vehiclePosition) {
      const canvas = this.minimapCanvas;
      const ctx = this.minimapCtx;
      const width = canvas.width;
      const height = canvas.height;
      const padding = 10;
      const rangeChunks = 5;
      const viewRadius = Math.max(chunkSize * rangeChunks, 1);
      const scale = (width - padding * 2) / (viewRadius * 2);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(8, 5, 12, 0.92)';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(120, 90, 130, 0.35)';
      ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

      const worldToMap = (wx, wy) => ({
        x: width / 2 + (wx - vehiclePosition.x) * scale,
        y: height / 2 - (wy - vehiclePosition.y) * scale,
      });

      for (const entry of exploredChunks) {
        const center = entry?.center;
        if (!center) continue;
        const dx = center.x - vehiclePosition.x;
        const dy = center.y - vehiclePosition.y;
        if (Math.abs(dx) > viewRadius + chunkSize || Math.abs(dy) > viewRadius + chunkSize) continue;
        const map = worldToMap(center.x, center.y);
        const size = chunkSize * scale;
        const biome = entry?.metadata?.biome ?? 'ember';
        const hazards = Math.abs(entry?.metadata?.hazards ?? 0);
        const palette = {
          lumenite: '#4dc9ff',
          siltstone: '#ffb15c',
          ember: '#ff7048',
        };
        const color = palette[biome] ?? '#ff8468';
        const alpha = 0.2 + Math.min(0.55, hazards * 0.28);
        ctx.fillStyle = hexToRgba(color, alpha);
        ctx.fillRect(map.x - size / 2, map.y - size / 2, size, size);
      }

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(width / 2, padding);
      ctx.lineTo(width / 2, height - padding);
      ctx.moveTo(padding, height / 2);
      ctx.lineTo(width - padding, height / 2);
      ctx.stroke();

      ctx.fillStyle = 'rgba(88, 224, 255, 0.9)';
      for (const beacon of beacons) {
        const pos = beacon?.position;
        if (!pos) continue;
        const point = worldToMap(pos.x, pos.y);
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      const forwardLength = 8;
      const triangleSize = 10;
      ctx.fillStyle = 'rgba(255, 219, 120, 0.95)';
      ctx.beginPath();
      ctx.moveTo(width / 2, height / 2 - triangleSize);
      ctx.lineTo(width / 2 - triangleSize * 0.6, height / 2 + triangleSize * 0.8);
      ctx.lineTo(width / 2 + triangleSize * 0.6, height / 2 + triangleSize * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.fillRect(width / 2 - 1, height / 2 - forwardLength, 2, forwardLength);
    }

    if (this.beaconList) {
      const summary = beacons
        .map((beacon) => `${beacon.index}:${Math.round(Math.max(0, beacon.distance || 0))}`)
        .join('|');
      if (summary !== this._lastBeaconSummary) {
        this.beaconList.innerHTML = '';
        for (const beacon of beacons) {
          const li = document.createElement('li');
          const distance = Math.round(Math.max(0, beacon.distance || 0));
          li.textContent = `Beacon ${beacon.index}: ${distance.toLocaleString()} m`;
          this.beaconList.appendChild(li);
        }
        if (beacons.length === 0) {
          const li = document.createElement('li');
          li.textContent = 'No active beacons';
          li.style.opacity = '0.6';
          this.beaconList.appendChild(li);
        }
        this._lastBeaconSummary = summary;
      }
    }
  }
}
