# Broker operational endpoints

The broker exposes a small set of HTTP endpoints for health checks, metrics
collection, and operational replay management. All paths are served from the
same host and port as the primary WebSocket listener.

## `/livez`

* **Method:** `GET`
* **Purpose:** Liveness probe that confirms the HTTP listener is reachable.
* **Response:** JSON payload containing an `alive` status and timestamp.
* **Authentication:** Not required.

Use this endpoint for container liveness checks. A non-`200 OK` response
indicates the process should be restarted.

## `/readyz`

* **Method:** `GET`
* **Purpose:** Readiness probe that verifies the broker finished startup and
  reports current WebSocket client counts.
* **Response:** JSON with readiness status, uptime in seconds, active clients,
  and pending handshake counts. Returns `503 Service Unavailable` while startup
  failures persist.
* **Authentication:** Not required.

## `/metrics`

* **Method:** `GET`
* **Purpose:** Prometheus-compatible text metrics describing broker state.
* **Response:** `text/plain; version=0.0.4` document containing gauges for
  uptime, connected clients, pending handshakes, and total broadcast payloads.
* **Authentication:** Not required.

Scrape this endpoint from Prometheus or curl it manually to verify live
statistics:

```bash
curl -s http://broker-host:43127/metrics
```

## `/replay/dump`

* **Method:** `POST`
* **Purpose:** Triggers a replay dump broadcast to all connected clients.
* **Response:** `202 Accepted` JSON with status and optional location once the
  dumper acknowledges the request.
* **Authentication:** Required. Include the configured admin token via either
  an `Authorization: Bearer <token>` header or `X-Admin-Token: <token>` header.

Replay triggers are rate limited. Configure the allowed burst and window with
`BROKER_REPLAY_DUMP_BURST` and `BROKER_REPLAY_DUMP_WINDOW`. Exceeding the
limit results in `429 Too Many Requests`.

Example request:

```bash
curl -X POST \
  -H "Authorization: Bearer $BROKER_ADMIN_TOKEN" \
  http://broker-host:43127/replay/dump
```

A `403 Forbidden` response indicates the broker was started without an admin
credential, while `401 Unauthorized` reflects a missing or invalid token.
