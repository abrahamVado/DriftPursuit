# Environment Configuration

The Drift Pursuit sandbox relies on a small `.env.local` file inside `game/` to surface runtime configuration to the Next.js frontend. The keys listed below are safe defaults for local development and align with the expectations baked into the onboarding UI.

## Required Keys

| Key | Purpose | Local sample |
| --- | --- | --- |
| `NEXT_PUBLIC_BROKER_WS_URL` | WebSocket endpoint for exchanging HUD telemetry with the broker service. | `ws://localhost:43127/ws` |
| `NEXT_PUBLIC_BROKER_HTTP_URL` | HTTP origin for the Python simulation bridge or diagnostics endpoints. | `http://localhost:8000` |

> [!TIP]
> Run `scripts/setup-env.sh` from the repository root to scaffold a `.env.local` file pre-populated with the values above, including inline comments that explain how to adjust them for non-local setups. When deploying the frontend separately from the bridge, update `NEXT_PUBLIC_BROKER_HTTP_URL` to point at the reachable origin.

> [!IMPORTANT]
> The simulation control panel talks directly to the configured bridge origin. Update `NEXT_PUBLIC_BROKER_HTTP_URL` whenever the Python service moves to a different host or port.

> [!NOTE]
> When the frontend runs inside Docker, the static assets are baked with production URLs at build time. The provided `docker-compose.yml` sets `NEXT_PUBLIC_BROKER_WS_URL=ws://broker:43127/ws` and `NEXT_PUBLIC_BROKER_HTTP_URL=http://broker:43127` so the browser can reach the bundled services.

## Manual Setup Checklist

1. Create `game/.env.local` if it does not exist.
2. Populate the keys above, adjusting the host/port to match your running services.
3. Restart `npm run dev` so the Next.js client reloads with the new environment variables.
