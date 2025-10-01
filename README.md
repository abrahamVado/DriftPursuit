# DriftPursuit - Starter Repo (Go broker + Python sim + three.js viewer)

This starter project wires together three pieces so you can focus on gameplay and visual polish:

- `go-broker/`: Simple Go WebSocket broker that relays messages and serves the static viewer.
- `python-sim/`: Python simulation client that publishes telemetry and cake drops.
- `viewer/`: A minimal three.js web client that subscribes to the broker feed.
  - Switch between available aircraft kits with the **Aircraft Model** dropdown in the viewer. Assets are cached locally so toggling sets is instant, your last choice is remembered in `localStorage`, and the legacy `?modelSet=` query parameter still works for deep links.
- `tunnelcave_sandbox_web/`: Self-contained Next.js + three.js endless cave sandbox that runs entirely in the browser.

## Tunnelcave Sandbox (Next.js)

Looking for a fully browser-hosted version of the tunnelcave prototype? The `tunnelcave_sandbox_web/` directory contains a standalone Next.js application that reproduces the endless cave, deterministic streaming, spawn selection, and third-person camera behaviors directly in React + three.js. To run it locally:

```bash
cd tunnelcave_sandbox_web
npm install
npm run dev
```

By default the dev server listens on [`http://localhost:3000`](http://localhost:3000). Open the page to load the sandbox, then use **W/S** to adjust throttle, **A/D** to bank, **Shift** to tighten the follow camera, and **Space** to level the craft. The entire pipeline lives within the Next.js app, so it can be deployed to any static Next-friendly host without referencing the Python or Go stacks.

The latest generator revamps the cave cross-section into a triple-lobe cavern: stacked north–south chambers stitched together by a twisting connector tunnel, with multi-octave rock noise layering fractal boulders onto every wall. The base radius is scaled up and streamed chunks remain deterministic, so existing spawn planning and occlusion-aware camera logic continue to function while the world feels more expansive.

## Viewer connection banner

The viewer shows a status banner while it connects to the Go broker. Earlier revisions of this documentation embedded a PNG screenshot from `docs/images/connection-banner.png`, but that asset is no longer versioned with the project. To capture a fresh banner image for release notes or runbooks:

1. Start the broker and viewer locally (see **Local Setup** below).
2. Launch the viewer at `http://localhost:8080/viewer/index.html`.
3. Grab a screenshot once the HUD panel reads “DriftPursuit Viewer – connecting…”.

Store the screenshot wherever you publish your documentation or knowledge base—keeping it out of the repository avoids unnecessary binary churn.

## Sandbox flight demo (three.js)

For a self-contained arcade flight sandbox that satisfies the open-world brief, serve the `viewer/` directory with any static file server and open the sandbox entry point:

```bash
cd viewer
npx http-server -p 8080 .
# or: python -m http.server 8080
```

Then visit [`http://localhost:8080/sandbox/index.html`](http://localhost:8080/sandbox/index.html).

Controls:

- **W / S (or ↑ / ↓)** – Pitch nose down / up
- **A / D (or ← / →)** – Roll left / right
- **Q / E** – Rudder yaw
- **R / F** – Increase / decrease throttle
- **X** – Hold for airbrake (cuts throttle quickly)

The HUD overlays throttle, airspeed, altitude, crash counter, and the same control reference. The world streams procedurally generated hills and mountain ridges around the aircraft, rebasing the origin automatically so you can keep flying without running into floating point precision issues. Colliding with terrain or props triggers an instant crash/restart and increments the counter.


Looking for a friendlier fixed-camera layout for casual pilots? See [`docs/casual-flight-controls.md`](docs/casual-flight-controls.md) for a beginner-focused scheme with auto-stabilization assists and presentation tips.


## Terra terrain flyover (three.js)

Need a spectator-friendly view of the procedural terrain without piloting the aircraft? Launch the Terra explorer to cruise above the same streaming world on a guided camera rail:

```bash
cd viewer
npx http-server -p 8080 .
# or: python -m http.server 8080
```

Then open [`http://localhost:8080/terra/index.html`](http://localhost:8080/terra/index.html). The camera glides along a slow loop, keeping the horizon framed while the `WorldStreamer` continuously loads and unloads chunks beneath it. This is a handy way to review lighting tweaks, terrain noise, or obstacle distribution without juggling the flight controls.


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
   go run .
   ```
   The broker will start on port `8080` and serve both HTTP and WebSocket traffic.
   A JSON summary of the broker status is exposed at `http://localhost:8080/api/stats`.
   A lightweight health endpoint is available at `http://localhost:8080/healthz` and reports HTTP 200 when the broker is healthy or 503 if a fatal startup issue was recorded.

   To enable HTTPS/WSS, provide a certificate and key (CLI flags take precedence over the matching environment variables):
   ```bash
   go run . --tls-cert=/path/to/cert.pem --tls-key=/path/to/key.pem
   # or
   export BROKER_TLS_CERT=/path/to/cert.pem
   export BROKER_TLS_KEY=/path/to/key.pem
   go run .
   ```
   With TLS enabled the viewer is available at `https://localhost:8080/viewer/index.html` and WebSocket clients should connect to `wss://localhost:8080/ws`.

2. **Configure allowed WebSocket origins (optional but recommended when deploying):**
   - By default the broker accepts local origins such as `http://localhost` and `http://127.0.0.1` so development "just works".
   - Supply a comma-separated allow list through the CLI flag or environment variable when you need additional origins:
     ```bash
     go run . -allowed-origins="http://localhost:5173,https://viewer.example.com"
     # or
     export BROKER_ALLOWED_ORIGINS="https://viewer.example.com,https://tools.example.com"
     go run .
     ```
   - The CLI flag takes precedence over the environment variable. Requests from origins not in the allow list (and not local) are rejected during the WebSocket upgrade.

      ### Broker options

   - **Maximum clients:** Limit concurrent WebSocket sessions with `--max-clients` (or `BROKER_MAX_CLIENTS`). The default is `256`; set it to `0` to allow unlimited clients. When the broker is at capacity, new connection attempts receive an HTTP 503 response and a log entry is emitted so operators can adjust the limit if needed.

3. **Adjust the inbound payload limit (optional):**
   - The broker rejects individual WebSocket messages larger than **1 MiB** by default to prevent runaway publishers from exhausting memory.
   - Override the limit with the CLI flag or the `BROKER_MAX_PAYLOAD_BYTES` environment variable when your protocol needs larger payloads:
     ```bash
     go run . -max-payload-bytes=2097152
     # or
     export BROKER_MAX_PAYLOAD_BYTES=2097152
     go run .
     ```
   - As with other settings, the CLI flag takes precedence when both are supplied.

4. **Run the Python simulation client** (publishes telemetry messages):

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
   Adjust the simulation cadence with ``--tick-rate`` (in Hertz) to slow down or
   speed up the autopilot loop:

   ```bash
   python client.py --tick-rate 60  # run at 60 Hz instead of the 30 Hz default
   ```

   To supply a custom autopilot loop, pass a waypoint file (see `docs/waypoints-format.md` for details):
   ```bash
   python client.py --waypoints-file path/to/loop.yaml
   ```

   To experiment with telemetry noise, supply the optional CLI flags. Noise
   defaults to zero so runs are deterministic unless you opt in:

   ```bash
   python client.py --pos-noise 5.0 --vel-noise 1.5 --random-seed 12345
   ```

   - `--pos-noise` adds up to the specified number of meters of positional
     jitter to each telemetry sample.
   - `--vel-noise` adds up to the specified meters/second of velocity
     variation.
   - `--random-seed` makes the injected noise deterministic so you can
     reproduce the same run later.

5. **Open the viewer** to visualize entities streaming from the simulation:
   - Navigate to `http://localhost:8080/viewer/index.html` in your browser.
   - You should see the 3D scene update in real time as telemetry arrives.
- Use the **Aircraft Model** dropdown to hot-swap between model sets. The HUD and console panel reflect loading progress so you know when a kit is ready.
- Use the **Tracked Aircraft** dropdown (or press `]` / `[`) to cycle the camera between active planes. The viewer keeps your selection even as new telemetry arrives, and stale planes are flagged in the list until they drop out.
- A Quickstart panel in the lower-left corner summarizes manual controls, keyboard shortcuts, and the autopilot loop toggle.

## Development

Run the Python unit tests after making changes to the navigation helpers:

```bash
cd python-sim
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pytest
```

## Key URLs

Once everything is running locally, you can visit these URLs:

| Purpose | URL |
| --- | --- |
| Broker health/root | `http://localhost:8080/` |
| Viewer web app | `http://localhost:8080/viewer/index.html` |
| WebSocket endpoint | `ws://localhost:8080/ws` |
| Broker statistics API | `http://localhost:8080/api/stats` |
| Protocol documentation | `docs/protocol.md` (local file) |

## Viewer connection banner

The viewer now surfaces connection health directly in the HUD and exposes a **Reconnect** action when the WebSocket is interrupted. Error and disconnect states render a prominent banner across the top of the screen so operators can recover quickly without reloading the page.

To document the feature for operators, capture an updated screenshot from a local build and attach it to your release notes or runbook as needed. The project intentionally avoids tracking large binary assets in Git, so add any reference imagery outside the repository (for example in your deployment docs wiki).

## Next Steps

- Swap out `viewer/assets/models/plane.gltf` with a high-fidelity model or add additional assets.
- Extend the Python simulator with more telemetry types, abilities, or cake physics.
- Expand the viewer UI with HUD elements, radar overlays, and controls.
- Refer to `docs/protocol.md` for message schemas when integrating additional clients.
