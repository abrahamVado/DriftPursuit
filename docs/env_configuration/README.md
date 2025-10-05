# Environment Configuration

The Drift Pursuit sandbox relies on a small `.env.local` file inside `tunnelcave_sandbox_web/` to surface runtime configuration to the Next.js frontend. The keys listed below are safe defaults for local development and align with the expectations baked into the onboarding UI.

## Required Keys

| Key | Purpose | Local sample |
| --- | --- | --- |
| `NEXT_PUBLIC_BROKER_URL` | Websocket endpoint for exchanging HUD telemetry with the broker service. | `ws://localhost:43127/ws` |
| `SIM_BRIDGE_URL` | Server-side override for the simulation bridge origin used by the API proxy. | `http://localhost:8000` |
| `NEXT_PUBLIC_SIM_BRIDGE_URL` | Optional browser-visible origin for bypassing the proxy during cross-origin development. | `http://localhost:8000` |

> [!TIP]
> Run `scripts/setup-env.sh` from the repository root to scaffold a `.env.local` file pre-populated with the values above, including inline comments that explain how to adjust them for non-local setups. When deploying the Next.js frontend separately from the bridge, set `SIM_BRIDGE_URL` on the server to avoid CORS preflight failures.

> [!IMPORTANT]
> The simulation control panel automatically falls back to `/api/sim-bridge/*` when no direct base URL override is supplied. With that proxy in place, configuring `SIM_BRIDGE_URL` on the server is enough to reach the bridge; only add `NEXT_PUBLIC_SIM_BRIDGE_URL` when the browser must talk to the bridge origin directly.

> [!NOTE]
> When the Next.js frontend runs inside Docker, `localhost` resolves to the container itself. Point `SIM_BRIDGE_URL` (and `NEXT_PUBLIC_SIM_BRIDGE_URL` when needed) at `http://host.docker.internal:8000` so the proxy can reach a bridge running on your host machine.

## Manual Setup Checklist

1. Create `tunnelcave_sandbox_web/.env.local` if it does not exist.
2. Populate the keys above, adjusting the host/port to match your running services.
3. Restart `npm run dev` so the Next.js client reloads with the new environment variables.
