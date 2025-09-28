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

2. Start the Python sim client (telemetry producer):
   - Create a virtualenv, install requirements: pip install -r requirements.txt
   - cd python-sim
   - python client.py
   This connects to ws://localhost:8080/ws and sends telemetry & occasional cake_drop messages.

3. Open the viewer in your browser:
   - Browse to http://localhost:8080/viewer/index.html
   - You should see a simple 3D scene and incoming entities from the sim.

Notes & next steps
- The viewer includes a placeholder box model for the plane; replace viewer/assets/models/plane.gltf with a realistic glTF model.
- This starter is intentionally minimal to get you running quickly. Expand sim/world.py and the viewer to add more gameplay features (abilities, radar overlays, cake physics).
- The message protocol is JSON over WebSocket. See docs/protocol.md for details.
