DriftPursuit - Starter Repo (Go broker + Python sim + three.js viewer)
====================================================================

This starter contains:
- go-broker/: simple WebSocket broker (Go) that relays messages and serves the viewer
- python-sim/: Python simulation client that sends telemetry and cake drops
- viewer/: a small three.js app (third-person view) connecting to the broker

Quickstart (all on one machine)
1. Start the Go broker (serves viewer and WS):
   - Install Go 1.20+
   - cd go-broker
   - go mod tidy
   - go run main.go
   Broker listens on http://localhost:8080

Configuring allowed WebSocket origins
-------------------------------------
The broker enforces an allowlist for incoming WebSocket connections. By default, only local development origins (`http://localhost`, `http://127.0.0.1`, etc.) are accepted so you can run everything on one machine without extra configuration.

- **Development:** No changes required when testing locally. Optional: `go run main.go -allowed-origins="http://localhost:5173"` to explicitly list your dev server.
- **Staging/Production:** Provide a comma-separated list of allowed origins through either the `-allowed-origins` flag or the `BROKER_ALLOWED_ORIGINS` environment variable. Example: `BROKER_ALLOWED_ORIGINS="https://viewer.example.com,https://tools.example.com" go run main.go`.
- The CLI flag takes precedence over the environment variable. Requests from origins not in the allowlist (and not local) will be rejected during the WebSocket upgrade.

2. Start the Python sim client (telemetry producer):
   - cd python-sim
   - Create a virtualenv, install requirements: pip install -r requirements.txt
   - python client.py
   This connects to ws://localhost:8080/ws by default and sends telemetry & occasional cake_drop messages.
   - To target a different broker, run `python client.py --broker-url ws://example.com:8080/ws` or set the
     `SIM_BROKER_URL` environment variable before running the client.

3. Open the viewer in your browser:
   - Browse to http://localhost:8080/viewer/index.html
   - You should see a simple 3D scene and incoming entities from the sim.

Notes & next steps
- The viewer includes a placeholder box model for the plane; replace viewer/assets/models/plane.gltf with a realistic glTF model.
- This starter is intentionally minimal to get you running quickly. Expand python-sim/ and the viewer to add more gameplay features (abilities, radar overlays, cake physics).
- The message protocol is JSON over WebSocket. See docs/protocol.md for details.
