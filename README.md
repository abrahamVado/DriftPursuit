# DriftPursuit - Starter Repo (Go broker + Python sim + three.js viewer)

This starter project wires together three pieces so you can focus on gameplay and visual polish:

- `go-broker/`: Simple Go WebSocket broker that relays messages and serves the static viewer.
- `python-sim/`: Python simulation client that publishes telemetry and cake drops.
- `viewer/`: A minimal three.js web client that subscribes to the broker feed.

## Prerequisites

- Go 1.20 or newer
- Python 3.10 or newer with `pip`
- Node.js/npm (optional, only needed if you plan to extend or rebuild the viewer assets)

## Local Setup

Follow these steps to bring the entire stack up locally on one machine:

1. **Start the Go broker** (serves the viewer and the WebSocket endpoint):
   ```bash
   cd go-broker
   go mod tidy
   go run main.go
   ```
   The broker will start on port `8080` and serve both HTTP and WebSocket traffic.

2. **Configure allowed WebSocket origins (optional but recommended when deploying):**
   - By default the broker accepts local origins such as `http://localhost` and `http://127.0.0.1` so development "just works".
   - Supply a comma-separated allow list through the CLI flag or environment variable when you need additional origins:
     ```bash
     go run main.go -allowed-origins="http://localhost:5173,https://viewer.example.com"
     # or
     export BROKER_ALLOWED_ORIGINS="https://viewer.example.com,https://tools.example.com"
     go run main.go
     ```
   - The CLI flag takes precedence over the environment variable. Requests from origins not in the allow list (and not local) are rejected during the WebSocket upgrade.

3. **Run the Python simulation client** (publishes telemetry messages):
   ```bash
   cd python-sim
   python -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   python client.py
   ```
   The client connects to `ws://localhost:8080/ws` by default. Override the broker URL or HTTP(S) origin if needed:
   ```bash
   python client.py --broker-url ws://example.com:8080/ws --origin https://example.com
   # or
   export SIM_BROKER_URL=ws://example.com:8080/ws
   export SIM_ORIGIN=https://example.com
   python client.py
   ```

4. **Open the viewer** to visualize entities streaming from the simulation:
   - Navigate to `http://localhost:8080/viewer/index.html` in your browser.
   - You should see the 3D scene update in real time as telemetry arrives.

## Key URLs

Once everything is running locally, you can visit these URLs:

| Purpose | URL |
| --- | --- |
| Broker health/root | `http://localhost:8080/` |
| Viewer web app | `http://localhost:8080/viewer/index.html` |
| WebSocket endpoint | `ws://localhost:8080/ws` |
| Protocol documentation | `docs/protocol.md` (local file) |

## Next Steps

- Swap out `viewer/assets/models/plane.gltf` with a high-fidelity model or add additional assets.
- Extend the Python simulator with more telemetry types, abilities, or cake physics.
- Expand the viewer UI with HUD elements, radar overlays, and controls.
- Refer to `docs/protocol.md` for message schemas when integrating additional clients.
