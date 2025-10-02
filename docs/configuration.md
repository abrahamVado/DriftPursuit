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
| `BROKER_LOG_LEVEL` | `info` | Minimum severity emitted by the structured logger (`debug`, `info`, `warn`, `error`). |
| `BROKER_LOG_PATH` | `broker.log` | Filesystem path for the rotating JSON log file. |
| `BROKER_LOG_MAX_SIZE_MB` | `100` | Maximum size (in megabytes) of the active log file before rotation occurs. |
| `BROKER_LOG_MAX_BACKUPS` | `10` | Number of rotated log files to retain on disk. |
| `BROKER_LOG_MAX_AGE_DAYS` | `7` | Maximum age in days for rotated log files before they are purged. |
| `BROKER_LOG_COMPRESS` | `true` | When `true`, rotated log files are gzip-compressed to save space. |
| `BROKER_WS_AUTH_MODE` | `disabled` | Controls WebSocket authentication: `disabled` or `hmac`. When `hmac`, clients must supply an HMAC-signed token. |
| `BROKER_WS_HMAC_SECRET` | *(empty)* | Shared secret used to validate HMAC WebSocket tokens. Required when `BROKER_WS_AUTH_MODE=hmac`. |
| `BROKER_GRPC_AUTH_MODE` | `shared_secret` | Controls gRPC authentication: `shared_secret` or `mtls`. Use `mtls` for production deployments. |
| `BROKER_GRPC_SHARED_SECRET` | *(empty)* | Shared secret clients must send via metadata when `BROKER_GRPC_AUTH_MODE=shared_secret`. |
| `BROKER_GRPC_TLS_CERT` | *(empty)* | PEM certificate presented by the gRPC server when `BROKER_GRPC_AUTH_MODE=mtls`. |
| `BROKER_GRPC_TLS_KEY` | *(empty)* | PEM key paired with `BROKER_GRPC_TLS_CERT` for gRPC mTLS. |
| `BROKER_GRPC_CLIENT_CA` | *(empty)* | PEM bundle of trusted client certificate authorities for gRPC mTLS. |

## Usage Tips

* Use the defaults for rapid local iterations; the broker will accept only loopback origins when no allowlist is provided.
* When deploying behind a load balancer or reverse proxy, set `BROKER_ADDR` to the internal bind address and configure TLS termination as appropriate.
* Keep `BROKER_MAX_PAYLOAD_BYTES` high enough for your simulation payloads while preventing runaway resource consumption from rogue clients.
* Shorter `BROKER_PING_INTERVAL` values can detect disconnects faster at the cost of extra network chatter.
* Enable `BROKER_WS_AUTH_MODE=hmac` alongside a strong `BROKER_WS_HMAC_SECRET` to protect the WebSocket fan-out channel.
* Toggle `BROKER_GRPC_AUTH_MODE` between `shared_secret` for local rigs and `mtls` with `BROKER_GRPC_TLS_*` for production clusters.
