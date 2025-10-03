# DriftPursuit Prototype

DriftPursuit is a cross-service prototype for a cavernous aerial battle royale experience. The repository contains:

- **go-broker/** — an authoritative Go simulation server with WebSocket and gRPC interfaces.
- **tunnelcave_sandbox_web/** — a three.js client that renders the cave world, HUD, and vehicle FX.
- **python-sim/** — reference bots and SDK utilities for automated playtesting.

Runtime behaviour is configuration-driven. Environment variable defaults and override guidance live in [docs/configuration.md](docs/configuration.md).

## Prerequisites

- Go 1.20 or newer (for local Go development)
- Node.js 18+ with npm (for the web client)
- Python 3.11 with Poetry (for the bot runner)
- Docker 24+ with the Compose plugin (for container workflows)

## Running Locally

### Option A — Native development

```bash
# Broker
cd go-broker
go run ./...

# In a new shell, run client assets
cd ../tunnelcave_sandbox_web
npm install
npm run dev

# Optional: launch reference bots
cd ../python-sim
poetry install
poetry run python scripts/run_bot.py
```

- The broker listens on `:43127` and serves WebSocket plus gRPC endpoints.
- The web client defaults to `http://localhost:3000` and expects `NEXT_PUBLIC_BROKER_URL` to reference the broker address.
- Bots use gRPC/WebSocket endpoints; ensure `BROKER_WS_URL` and `BROKER_GRPC_ADDR` match your local broker settings.

Key broker endpoints while iterating:

- `GET /healthz` — liveness probe reporting uptime and connection counts.
- `GET /api/stats` — current broadcast totals and active clients.
- `GET /api/controls` — metadata describing available in-game inputs.

Structured JSON logs (default `broker.log`) include `trace_id` values so you can trace events across the stack. Propagation details live in [docs/tracing.md](docs/tracing.md).

### Option B — Docker Compose

The Compose workflow starts all three services with matching configuration:

```bash
docker compose build
docker compose up
```

Service summary:

- **broker** — exposed on `localhost:43127`; override environment variables via `.env` or inline Compose edits.
- **bot-runner** — connects using `BROKER_WS_URL=ws://broker:43127/ws` and propagates the configured `TRACE_HEADER`.
- **web-client** — served on `http://localhost:3000` with `NEXT_PUBLIC_BROKER_URL` pointed at the broker container.

Shut everything down with `docker compose down` and inspect logs using `docker compose logs -f <service>`.

### Building container images individually

```bash
# Go broker
docker build -t driftpursuit/broker:local go-broker

# Python bot runner
docker build -t driftpursuit/bot-runner:local python-sim

# Web client
docker build -t driftpursuit/web-client:local tunnelcave_sandbox_web
```

## Web Client Controls

The Tunnelcave sandbox web client ships with the following keyboard layout. Each action maps to the underlying vehicle control axis noted below:

| Action | Default Key | Axis |
| --- | --- | --- |
| Accelerate | W | Throttle (positive) |
| Brake / Reverse | S | Brake (positive) |
| Steer Left | A | Steer (negative) |
| Steer Right | D | Steer (positive) |
| Handbrake | Space | Handbrake (toggle) |
| Boost | Left Shift | Boost (toggle) |
| Shift Down | Q | Gear (negative) |
| Shift Up | E | Gear (positive) |

Accessibility settings allow players to rebind any action while still displaying the original defaults for reference. The in-game help overlay lists the current key along with the default so customised layouts remain easy to share during cooperative play.

### Accessibility Features

- **Rebind controls in-game** — The sandbox includes a keybinding menu that listens for the next key press and stores overrides locally so every session honours player preferences.
- **Colour-safe radar palettes** — Switch between the classic high-contrast palette and a deuteranopia-friendly variant; the HUD updates immediately without a reload.
- **Reduced-motion mode** — Toggle calmer interface animations to assist players sensitive to rapid movement.
- Accessibility preferences persist to the browser's local storage and can be reset by clearing the stored data.

## Development

Run the unit tests to validate protocol handling and configuration parsing:

```bash
cd go-broker
go test ./...
```

## Screenshot Capture Task

Planning a visual refresh? Follow the dedicated task at [docs/screenshot_task/task.md](docs/screenshot_task/task.md) to collect gameplay, map, and vehicle imagery with consistent metadata.

## Continuous Integration

The [`Docker images`](.github/workflows/docker-images.yml) workflow builds all production containers on every push and pull request to ensure the Dockerfiles stay healthy.

## Repository Layout

- `go-broker/` — the WebSocket broker service and tests.
- `python-sim/` — Python bot runner assets and Dockerfile.
- `tunnelcave_sandbox_web/` — the web client application and Dockerfile.
- `docs/` — configuration reference material for operators, including [networking schema versioning guidance](docs/networking_versioning.md).
- `docker-compose.yml` — orchestration for the broker, bot runner, and web client.
