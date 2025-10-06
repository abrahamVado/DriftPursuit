# Environment Configuration

The Drift Pursuit sandbox relies on a small `.env.local` file inside `planet_sandbox_web/` to surface runtime configuration to the Vite frontend. The keys listed below are safe defaults for local development and align with the expectations baked into the onboarding UI.

## Required Keys

| Key | Purpose | Local sample |
| --- | --- | --- |
| `VITE_BROKER_URL` | Websocket endpoint for exchanging HUD telemetry with the broker service. | `ws://localhost:43127/ws` |
| `VITE_SIM_BRIDGE_URL` | HTTP origin for the Python simulation bridge. | `http://localhost:8000` |

> [!TIP]
> Run `scripts/setup-env.sh` from the repository root to scaffold a `.env.local` file pre-populated with the values above, including inline comments that explain how to adjust them for non-local setups. When deploying the frontend separately from the bridge, update `VITE_SIM_BRIDGE_URL` to point at the reachable origin.

> [!IMPORTANT]
> The simulation control panel talks directly to the configured bridge origin. Update `VITE_SIM_BRIDGE_URL` whenever the Python service moves to a different host or port.

> [!NOTE]
> When the frontend runs inside Docker, the static assets are baked with production URLs at build time. The provided `docker-compose.yml` sets `VITE_BROKER_URL=ws://host.docker.internal:43127/ws` and `VITE_SIM_BRIDGE_URL=http://localhost:8000` so the browser can reach the bundled services.

## Manual Setup Checklist

1. Create `planet_sandbox_web/.env.local` if it does not exist.
2. Populate the keys above, adjusting the host/port to match your running services.
3. Restart `npm run dev` so the Vite client reloads with the new environment variables.
