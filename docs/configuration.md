# Broker Configuration

The Battle Royale broker is configured entirely through environment variables. Each setting has a reasonable default so the service can run with no extra configuration for local development. Override any of the keys below to tune deployments.

| Variable | Default | Description |
| --- | --- | --- |
| `BROKER_ADDR` | `:43127` | TCP address the broker listens on. Set to `host:port` to bind to a specific interface. |
| `BROKER_ALLOWED_ORIGINS` | *(empty)* | Comma-separated list of HTTPS origins that are permitted to open WebSocket connections. Localhost hosts are always allowed for development. |
| `BROKER_MAX_PAYLOAD_BYTES` | `1048576` | Maximum size (in bytes) accepted for inbound WebSocket messages. |
| `BROKER_PING_INTERVAL` | `30s` | Interval for WebSocket ping frames. Must be a positive Go duration string (e.g. `45s`, `2m`). |
| `BROKER_MAX_CLIENTS` | `256` | Soft cap on concurrent WebSocket clients. Use `0` to remove the limit entirely. |
| `BROKER_TLS_CERT` | *(empty)* | Path to a PEM-encoded TLS certificate. Must be provided together with `BROKER_TLS_KEY` to enable TLS. |
| `BROKER_TLS_KEY` | *(empty)* | Path to the PEM-encoded TLS private key. Must be provided with `BROKER_TLS_CERT`. |

## Usage Tips

* Use the defaults for rapid local iterations; the broker will accept only loopback origins when no allowlist is provided.
* When deploying behind a load balancer or reverse proxy, set `BROKER_ADDR` to the internal bind address and configure TLS termination as appropriate.
* Keep `BROKER_MAX_PAYLOAD_BYTES` high enough for your simulation payloads while preventing runaway resource consumption from rogue clients.
* Shorter `BROKER_PING_INTERVAL` values can detect disconnects faster at the cost of extra network chatter.
