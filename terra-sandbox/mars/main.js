import { MarsSandbox } from './marsSandbox.js';

function getElement(id) {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing required element: ${id}`);
  }
  return el;
}

const canvas = getElement('mars-canvas');
const statusLabel = getElement('mars-status');
const altitudeOutput = getElement('mars-altitude');
const temperatureOutput = getElement('mars-temperature');
const windOutput = getElement('mars-wind');
const speedOutput = getElement('mars-speed');
const throttleOutput = getElement('mars-throttle');
const weaponOutput = getElement('mars-weapon');
const seedOutput = getElement('mars-seed');

const sandbox = new MarsSandbox({
  canvas,
  statusLabel,
  altitudeOutput,
  temperatureOutput,
  windOutput,
  speedOutput,
  throttleOutput,
  weaponOutput,
  seedOutput,
});

sandbox.initialize();
sandbox.start();

const controls = document.querySelectorAll('.controls button[data-action]');
controls.forEach((button) => {
  const action = button.dataset.action;
  button.addEventListener('click', () => {
    if (action === 'reset') {
      sandbox.resetVehicle();
    } else if (action === 'shuffle') {
      sandbox.regenerate();
    }
  });
});

window.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    sandbox.stop();
  } else {
    sandbox.start();
  }
});
