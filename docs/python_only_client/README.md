# Python-Only Piloting Guide

This guide explains how to fly Drift Pursuit vehicles using the existing Python SDK instead of the unfinished Next.js web shell.

## When to Choose Python Over Next.js

- **You only need direct control:** The Go broker already exposes the gRPC `/PublishIntents` stream that the Python `IntentClient` wraps, so you can send throttle, yaw, pitch, roll, boost, and reset commands without a browser session.【F:python-sim/bot_sdk/intent_client.py†L36-L118】
- **You want broker diffs programmatically:** `StateStreamReceiver` consumes the broker's state diff stream, buffers it in tick order, and raises callbacks for your game logic—no DOM or rendering required.【F:python-sim/bot_sdk/state_stream.py†L1-L102】
- **You prefer a CLI wrapper:** `python -m bots.fsm_cli` already wires both helpers together and lets you drive archetype bots against the live broker or record intents offline.【F:python-sim/bots/fsm_cli.py†L1-L118】
- **You only need heads-up telemetry:** The Next.js client ships as a minimal shell with empty render anchors, so it provides no visual advantages yet beyond what you script yourself.【F:README.md†L1-L82】

Choose the web client once you have Three.js rendering, cockpit HUD, or matchmaking UX needs. Until then, the Python path is faster for raw piloting and telemetry capture.

## Prerequisites

1. **Broker runtime** — Go 1.20+, `go run .` inside `go-broker/`.
2. **Python tooling** — Python 3.11 with Poetry to install `python-sim/` dependencies.
3. **Shared secret** — If gRPC auth is enabled, export `BROKER_GRPC_SHARED_SECRET` so Python and the broker agree.【F:README.md†L24-L78】

## Launching a Python-Only Session

1. **Start the broker**
   ```bash
   cd go-broker
   export BROKER_WS_AUTH_MODE=disabled
   export BROKER_GRPC_AUTH_MODE=shared_secret
   export BROKER_GRPC_SHARED_SECRET=dev-secret
   go run .
   ```
2. **Install the Python SDK**
   ```bash
   cd ../python-sim
   poetry install
   ```
3. **Stream world diffs and send intents**
   ```bash
   poetry run python -m bots.fsm_cli patrol \
     --client-id cli-pilot \
     --waypoints "0,0;50,0;50,50;0,50" \
     --allow-boost \
     --diff-log -
   ```
   - `IntentClient` connects to `localhost:43127` by default; override with `--address` if you run the broker elsewhere.【F:python-sim/bots/fsm_cli.py†L47-L118】
   - Supply `--dry-run` to record generated intents without hitting the broker, or drop `--diff-log -` to stream live diffs.

## Building Your Own Controller

1. **Subscribe to diffs** — Instantiate `StateStreamReceiver` and feed it `StateDiffFrame` messages from the broker gRPC stream; the receiver keeps ticks ordered and exposes latency samples for debugging.【F:python-sim/bot_sdk/state_stream.py†L1-L102】
2. **Publish intents** — Create an `IntentClient`, call `start()`, push dictionaries with desired control values via `send_intent`, and finally call `stop()` to flush acknowledgements.【F:python-sim/bot_sdk/intent_client.py†L24-L118】
3. **Compose a loop** — Combine both helpers in a coroutine or thread to react to diffs and emit intents at the cadence you configure (10–20 Hz supported).【F:python-sim/bot_sdk/intent_client.py†L36-L82】

You can strip down the FSM CLI, reuse its parser, or write your own loop—no web client is required for any of these flows.

## When to Reintroduce Next.js

Return to the Next.js shell once you need:

- GPU-rendered cave geometry and cockpit instrumentation once Three.js assets are ready.
- Mouse/keyboard bindings for human pilots instead of scripted bots.
- Session selection and match lifecycle UI.

Until those features are implemented, the Python SDK remains the quickest path to playable sessions.
