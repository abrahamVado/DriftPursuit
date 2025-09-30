function formatNumber(value, digits = 0) {
  return value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
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
  }) {
    this.statusLabel = statusLabel;
    this.altitudeOutput = altitudeOutput;
    this.temperatureOutput = temperatureOutput;
    this.windOutput = windOutput;
    this.speedOutput = speedOutput;
    this.throttleOutput = throttleOutput;
    this.weaponOutput = weaponOutput;
    this.seedOutput = seedOutput;
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
}
