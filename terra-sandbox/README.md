# DriftPursuit Terra Sandbox

This directory contains a standalone copy of the Terra sandbox viewer so it can be used without the original `viewer` package.  Open [`index.html`](./index.html) in a browser (with a local web server) to explore the sandbox experience.

## Structure

- `index.html` – entry point that loads the Terra sandbox module.
- `terra/` – Terra-specific gameplay logic, UI, and world configuration.
- `sandbox/` – reusable controllers, camera, HUD, noise utilities, and other helpers extracted from the original viewer.
- `shared/` – shared Three.js bootstrap helpers.
- `world/` – terrain streaming implementation used by the Terra sandbox.

The sandbox expects Three.js (and optionally the GLTF loader if you use glTF assets) to be available globally; `index.html` loads the runtime build from the jsDelivr CDN by default.
