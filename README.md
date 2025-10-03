# DriftPursuit Prototype

DriftPursuit is a cross‑service prototype for a cavernous aerial battle‑royale experience.

The repository contains:

- **go-broker/** — authoritative Go simulation server with WebSocket and gRPC interfaces.
- **tunnelcave_sandbox_web/** — three.js web client that renders the cave world, HUD, and vehicle FX.
- **python-sim/** — reference bots and SDK utilities for automated playtesting.

Runtime behaviour is configuration‑driven. Environment variable defaults and override guidance live in
[docs/configuration.md](docs/configuration.md).

---

## Prerequisites

- **Go 1.20+** (for the broker)
- **Node.js 18+** with **npm** (for the web client) — you may use **pnpm** if preferred
- **Python 3.11** with **Poetry** (for the bot runner)
- **Docker 24+** with the Compose plugin (optional, for container workflows)

> If you use pnpm for the web client, ensure `corepack enable` is run once on your machine.

---

## Quick Start

1. **Clone the repository**
   ```bash
   git clone <repo-url>
   cd DriftPursuit
   ```

2. **Install dependencies**
   - **Broker (Go)**
     ```bash
     cd go-broker
     go mod download
     cd ..
     ```
   - **Web client (three.js app)**
     ```bash
     cd tunnelcave_sandbox_web
     npm install            # or: pnpm install
     cd ..
     ```
   - **Bots / SDK (Python)**
     ```bash
     cd python-sim
     sudo apt install python3-poetry
     poetry install
     cd ..
     ```

3. **Start the broker (terminal A)**
   ```bash
   cd go-broker

    # dev-friendly auth
    export BROKER_WS_AUTH_MODE=disabled
    export BROKER_GRPC_AUTH_MODE=shared_secret
    export BROKER_GRPC_SHARED_SECRET=$(openssl rand -hex 32)  # or any string

    go run .

   ```
   - Broker listens on **:43127** (WebSocket + gRPC).

4. **Start the web client (terminal B)**
   ```bash
   cd tunnelcave_sandbox_web
   npm run dev
   ```
   - Served at **http://localhost:3000**.
   - Ensure the web client knows how to reach the broker via env:
     ```bash
     # in tunnelcave_sandbox_web/.env.local (example)
     NEXT_PUBLIC_BROKER_URL=ws://localhost:43127/ws
     ```

5. **(Optional) Run a reference bot (terminal C)**
   ```bash
   cd python-sim
   poetry run python scripts/run_bot.py
   ```
   - If needed, set:
     ```bash
     BROKER_WS_URL=ws://localhost:43127/ws
     BROKER_GRPC_ADDR=localhost:43127
     ```

6. **(Optional) One‑command stack with Docker Compose**
   ```bash
   docker compose build
   docker compose up
   ```
   - Web: **http://localhost:3000**
   - Broker: **localhost:43127**
   - Stop with `docker compose down`.

7. **(Optional) Build container images individually**
   ```bash
   # Go broker
   docker build -t driftpursuit/broker:local go-broker

   # Python bot runner
   docker build -t driftpursuit/bot-runner:local python-sim

   # Web client
   docker build -t driftpursuit/web-client:local tunnelcave_sandbox_web
   ```

8. **(Optional) Production build for the web client**
   ```bash
   cd tunnelcave_sandbox_web
   npm run build
   npm run start   # serves the built Next.js app (adjust to your script names)
   ```

---

## Running Locally (detailed)

### Option A — Native development

```bash
# Broker
cd go-broker
go run ./...

# In a new shell, run client assets
cd ../tunnelcave_sandbox_web
npm install      # or pnpm install
npm run dev

# Optional: launch reference bots
cd ../python-sim
poetry install
poetry run python scripts/run_bot.py
```

- The broker listens on **:43127** and serves **WebSocket** plus **gRPC** endpoints.
- The web client defaults to **http://localhost:3000** and expects **NEXT_PUBLIC_BROKER_URL** to reference the broker address.
- Bots use gRPC/WebSocket endpoints; ensure **BROKER_WS_URL** and **BROKER_GRPC_ADDR** match your local broker settings.

Key broker endpoints while iterating:

- `GET /healthz` — liveness probe reporting uptime and connection counts.
- `GET /api/stats` — current broadcast totals and active clients.
- `GET /api/controls` — metadata describing available in‑game inputs.

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

---

## Web Client Controls

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

### Accessibility Features

- **Rebind controls in‑game** (persistent overrides in local storage).
- **Colour‑safe radar palettes** (classic high‑contrast and deuteranopia‑friendly).
- **Reduced‑motion mode** (calmer interface animations).

---

## Development

```bash
cd go-broker
go test ./...
```

---

## Screenshot Capture Task

See [docs/screenshot_task/task.md](docs/screenshot_task/task.md) for consistent gameplay, map, and vehicle imagery capture.

---

## Continuous Integration

The [`Docker images`](.github/workflows/docker-images.yml) workflow builds all production containers on every push and pull request.