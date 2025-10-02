# Battle Royale Broker

This repository hosts the Go WebSocket broker that powers the Battle Royale prototype. The broker fan-outs telemetry between gameplay clients and exposes lightweight operational endpoints.

All runtime tuning is controlled through environment variables. See [docs/configuration.md](docs/configuration.md) for the complete list and defaults.

## Prerequisites

- Go 1.20 or newer

## Running Locally

```bash
cd go-broker
go run ./...
```

The broker listens on `:43127` by default. Override the address or other tunables with the documented environment variables. When TLS certificate and key paths are supplied the server automatically serves HTTPS/WSS.

Health and monitoring endpoints:

- `GET /healthz` — liveness probe reporting broker uptime and connection counts.
- `GET /api/stats` — JSON statistics about broadcast totals and active clients.
- `GET /api/controls` — metadata describing available in-game controls.

## Development

Run the unit tests to validate protocol handling and configuration parsing:

```bash
cd go-broker
go test ./...
```

## Repository Layout

- `go-broker/` — the WebSocket broker service and tests.
- `docs/` — configuration reference material for operators.
