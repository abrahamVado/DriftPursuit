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

### Tunnelcave Sandbox — Implementation Brief (No Formulas)

#### 1. Sweep-based tunnel terrain (endless cave)

**Concept.** The cave is represented as a tube traveling along an infinite 3D path driven by a smooth, divergence-free vector field—think of following a wind that never compresses or expands. Around that path we sweep a circular cross-section whose radius changes gradually, creating alternating tight corridors and roomy caverns. A touch of angular noise keeps the walls rocky. Every point on the path maintains a stable local frame consisting of the tangent (forward) direction and two perpendicular unit vectors spanning the ring plane. Update this frame with parallel transport so it only rotates when the curve forces it to.

**Parameters.**

* `worldSeed` (integer) for global determinism.
* `chunkLength` (meters) defines the streamed arc span per chunk.
* `ringStep` (meters) sets spacing between consecutive rings.
* `tubeSides` (integer, 12–24) controls cross-section tessellation.
* `dirFreq` (~0.03–0.08) governs how quickly the path turns.
* `dirBlend` (0–1) smooths successive directions.
* `radiusBase` (meters) is the average tunnel radius.
* `radiusVar` (meters) is the amplitude of radius modulation.
* `radiusFreq` (below `dirFreq`) dictates how fast radius changes.
* `roughAmp` (meters) controls wall roughness magnitude.
* `roughFreq` (above `radiusFreq`) sets roughness frequency along the path and ring.
* `joltEveryMeters` (meters) establishes the mean spacing between rare sharp turns.
* `joltStrength` (0–1) scales how severe each jolt is.
* `maxTurnPerStepRad` (radians per ring) clamps curvature for stability.
* `mode` selects output: `"mesh"`, `"sdf"`, or `"mesh+sdf"`.

**Required behaviors.**

* *Direction field:* Derive a divergence-free field by taking the curl of a three-component noise vector potential, sample it at a scaled path position for the next heading, normalize, smooth via `dirBlend`, and clamp angle deltas to `maxTurnPerStepRad`.
* *Maze-like “jolts”:* Seeded by `(worldSeed, chunkIndex)`, inject impulse turns at random arc positions separated on average by `joltEveryMeters`, add a random unit vector scaled by `joltStrength`, and renormalize.
* *Parallel transport frame:* Keep an orthonormal frame, rotating the cross-section basis only by the minimal amount needed to align the forward vector between steps and skipping rotations when the turn is negligible to avoid flips.
* *Radius profile and roughness:* Compute radius as `radiusBase` plus a slow scalar noise sampled at `radiusFreq`. Add small scalar noise that depends on path position and angular coordinate (periodic around the ring) to model wall roughness. Ensure the combined radius never collapses to zero.
* *Surface generation (mesh mode):* For each ring, place `tubeSides` vertices in the cross-section plane at distance `radius + roughness`, stitch neighboring rings with triangle strips, and track the chunk AABB, radius extrema, and widest ring index.
* *Signed distance (SDF mode):* Approximate the cave as the minimum distance to all centerline segments minus the local radius, then add high-frequency fractal noise. Evaluate only within slab AABBs around relevant chunks, returning negative inside values, zero on the surface, and positive outside values.
* *Streaming:* Chunk `k` covers arc `[k * chunkLength, (k + 1) * chunkLength)`. Use `round(chunkLength / ringStep) + 1` rings per chunk, sharing boundary rings. All random decisions depend solely on `(worldSeed, k)` for reproducibility.

**Acceptance checks.**

* Forward vectors remain unit length.
* Frame vectors stay orthonormal.
* Instantaneous turns never exceed `maxTurnPerStepRad`.
* `radius + roughness` stays strictly positive.
* Regenerating a chunk with the same seed yields identical vertex data.

#### 2. Robust spawn probing against the cave

*Define clearance.* At any ring, cast rays in the plane perpendicular to the forward direction along opposite directions (e.g., “up” and “down”) to locate wall intersections. Summing the two distances yields the diameter along that axis. Optionally sample multiple angles to estimate minimum, mean, and standard deviation of the diameter.

*Pick a spawn ring.* Compute a roominess score favoring large base radius, large mean diameter, and low variance. Search rings near the target arc range, expanding the window by chunk if no ring meets safety margins. Ranked choices are deterministic: if the best fails validation, fall through to the next, eventually defaulting to the widest ring in the nearest loaded chunk.

*Place the craft.* Position it at the ring center, offset along the selected in-plane axis to sit at mid-clearance. Verify both sides retain at least the craft’s in-plane bounding radius; if not, ease the offset toward the center until margins are satisfied. Align craft forward with the path forward vector, and choose roll so the thinner profile faces the tighter clearance direction.

*Acceptance checks.* The craft’s surface samples must remain outside the cave walls after subtracting a safety buffer, and the algorithm must return identical spawn poses for the same seeds and search window.

#### 3. Sandbox hookup (systems and chunking)

*Chunking model.* Track the craft’s arc coordinate, keep it at least one chunk inside the loaded band, and typically maintain chunks spanning indices `[-2, +3]` relative to the current position. Unload chunks outside that band and recycle GPU buffers where possible. Adjacent chunks share boundary rings bit-for-bit.

*Third-person camera.* Compute the desired camera position by starting at the ship position, moving backward along its forward vector for follow distance, then offsetting by tuned amounts along the first and second in-plane frame vectors for height and lateral swing. Move the actual camera toward both the desired position and look-at target with an exponential smoother (critically damped, configurable time constant) to produce lag without overshoot.

*Determinism and seeding.* All stochastic behavior—including jolts and per-chunk tiebreakers—derives from hashes seeded solely by `worldSeed` and chunk or ring indices. Avoid global mutable RNG state.

*Interfaces.*

  * Terrain generator: Given a chunk index, output rings (center point, frame, radius, roughness metadata) plus either a mesh or an SDF evaluator restricted to the chunk’s AABB.
  * Probe API: For a ring and an in-plane direction, report clearance distances in both directions or aggregate min/mean/variance over sampled angles.
  * Spawn API: Given an arc window and craft radius, return a deterministic spawn pose or a typed failure detailing fallback instructions.

*Acceptance checks.*

* Streaming shows no gaps—the final ring in chunk `k` equals the first ring in `k+1` bitwise.
* The camera respects its SDF margin and never clips the wall.
* Reloading the same chunk band around a given arc reproduces identical geometry.

**Tuning cheatsheet.** Increase `dirFreq` for tighter labyrinths, or decrease it for sweeping curves. Boost `joltStrength` or shorten `joltEveryMeters` for more dramatic whips. Keep `radiusFreq` notably lower than `dirFreq` to alternate big rooms with narrow connectors. Scale `roughAmp` well below `radiusBase` so rockiness never pinches the tunnel closed. If players struggle on tight bends, clamp harder with `maxTurnPerStepRad` or lower `ringStep` for denser sampling.


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
