# Battle Royale Broker

This repository hosts the Go WebSocket broker that powers the Battle Royale prototype. The broker fan-outs telemetry between gameplay clients and exposes lightweight operational endpoints. A Python bot runner and the web client live alongside the broker code so the entire prototype can be containerised together.

All runtime tuning is controlled through environment variables. See [docs/configuration.md](docs/configuration.md) for the complete list and defaults.

## Prerequisites

- Go 1.20 or newer (for local Go development)
- Docker 24+ with the Compose plugin (for container workflows)

## Running Locally

### Native Go workflow

```bash
cd go-broker
go run ./...
```

The broker listens on `:43127` by default. Override the address or other tunables with the documented environment variables. When TLS certificate and key paths are supplied the server automatically serves HTTPS/WSS.

Health and monitoring endpoints:

- `GET /healthz` — liveness probe reporting broker uptime and connection counts.
- `GET /api/stats` — JSON statistics about broadcast totals and active clients.
- `GET /api/controls` — metadata describing available in-game controls.

Structured JSON logs are emitted to a rotating file (default `broker.log`) and include a `trace_id` field. See [docs/tracing.md](docs/tracing.md) for guidance on propagating the `X-Trace-ID` header across bots and web clients.

### Docker Compose stack

Spin up the full prototype — broker, bot runner, and web client — with Compose:

```bash
docker compose build
docker compose up
```

The services share the `battleground` network defined in [`docker-compose.yml`](docker-compose.yml):

- **broker** — exposed on `localhost:43127`; environment variables can be overridden via Compose or a `.env` file (for example `BROKER_ALLOWED_ORIGINS`).
- **bot-runner** — connects to the broker using `BROKER_WS_URL=ws://broker:43127/ws` and forwards the trace header defined by `TRACE_HEADER`.
- **web-client** — exposed on `localhost:3000` with `NEXT_PUBLIC_BROKER_URL` pointing at the broker service.

Stop the stack with `docker compose down`. Use `docker compose logs -f <service>` to inspect container output.

### Building individual images

To build any image separately without Compose:

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

## Development

Run the unit tests to validate protocol handling and configuration parsing:

```bash
cd go-broker
go test ./...
```

## Continuous Integration

The [`Docker images`](.github/workflows/docker-images.yml) workflow builds all production containers on every push and pull request to ensure the Dockerfiles stay healthy.

## Repository Layout

- `go-broker/` — the WebSocket broker service and tests.
- `python-sim/` — Python bot runner assets and Dockerfile.
- `tunnelcave_sandbox_web/` — the web client application and Dockerfile.
- `docs/` — configuration reference material for operators, including
  [networking schema versioning guidance](docs/networking_versioning.md).
- `docker-compose.yml` — orchestration for the broker, bot runner, and web client.
