# Web Bridge Integration Plan

## Audit Summary
- `python-sim` exposes vehicle state via physics modules and now provides an HTTP bridge at `web_bridge.server` for handshake, state polling, and command dispatch.
- `tunnelcave_sandbox` hosts legacy simulation scenes compatible with the Python runtime.
- `planet_sandbox_web` renders the browser client using Vite + React, with components that connect directly to the HTTP bridge.

## Communication Layer Decisions
- Initial integration keeps the authoritative simulation in Python and synchronises through an HTTP bridge to reduce browser-side porting.
- REST-style endpoints (`/handshake`, `/state`, `/command`) provide a minimal surface area that can be upgraded to WebSockets once telemetry streaming is required.

## Asset Pipeline Considerations
- Vehicle meshes reside under `tunnelcave_sandbox/assets` (export tooling to be added in subsequent iterations).
- Convert assets to `glTF` using Blender export presets to minimise file size before publishing to the web client.

## Front-End Rendering & Controls
- The Vite client includes `SimulationBridgePanel`, enabling handshake verification and dispatch of throttle/brake commands.
- Integration with the 3D renderer will map telemetry returned by `/state` into scene graph updates.

## Back-End API
- `SimulationControlServer` hosts the HTTP bridge with pluggable state providers and command handlers so existing simulation loops can push telemetry into the bridge without refactors.
- Default state provider supplies placeholder telemetry for development and testing.

## Synchronisation Strategy
- Clients poll `/state` for now. Upgrade paths include server-sent events or WebSockets for smoother telemetry updates when the simulation loop is wired in.

## Alternative Control Surfaces
- Python CLI or desktop clients can reuse the HTTP bridge endpoints to issue commands without depending on the browser stack.

## Deployment Notes
- Start the server via `python -m web_bridge.server` with `PYTHONPATH=python-sim` during development.
- Run `npm run dev` inside `planet_sandbox_web` and set `VITE_SIM_BRIDGE_URL` to the bridge origin (e.g. `http://localhost:8000`).

## Next Steps
- Wire real simulation telemetry into the `state_provider` callback.
- Streamline asset conversion scripts and document Blender export presets.
- Expand the control surface with keyboard/gamepad bindings and interpolation against streamed telemetry.
