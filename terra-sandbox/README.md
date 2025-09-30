# DriftPursuit Terra Sandbox

This directory contains a standalone copy of the DriftPursuit Terra sandbox from the original `viewer` package so it can be
loaded independently (e.g. from the Go broker `/terra-sandbox/` route).

Open [`index.html`](./index.html) in a browser (served from a local web server) to explore the sandbox experience.

## Structure

- `index.html` – entry point that bootstraps the Terra sandbox module.
- `terra/` – Terra-specific gameplay logic, HUD, world streamer wiring, and map configuration.
- `sandbox/` – reusable controllers, camera helpers, HUD overlays, and supporting systems extracted from the original viewer.
- `shared/` – shared Three.js bootstrap helpers.
- `world/` – terrain streaming and procedural generation helpers used by the sandbox.

Three.js **must** be available on the page. The sandbox now loads the Three.js ES module directly from the entry bundle and
continues to lazily import the GLTF loader so the experience matches the original viewer bundle without requiring
additional script tags.
