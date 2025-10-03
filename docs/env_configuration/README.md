# Environment Configuration

The Drift Pursuit sandbox relies on a small `.env.local` file inside `tunnelcave_sandbox_web/` to surface runtime configuration to the Next.js frontend. The keys listed below are safe defaults for local development and align with the expectations baked into the onboarding UI.

## Required Keys

| Key | Purpose | Local sample |
| --- | --- | --- |
| `NEXT_PUBLIC_BROKER_URL` | Websocket endpoint for exchanging HUD telemetry with the broker service. | `ws://localhost:43127/ws` |
| `NEXT_PUBLIC_SIM_BRIDGE_URL` | HTTP origin that exposes the simulation bridge handshake and command endpoints. | `http://localhost:8000` |

> [!TIP]
> Run `scripts/setup-env.sh` from the repository root to scaffold a `.env.local` file pre-populated with the values above, including inline comments that explain how to adjust them for non-local setups.

## Manual Setup Checklist

1. Create `tunnelcave_sandbox_web/.env.local` if it does not exist.
2. Populate the keys above, adjusting the host/port to match your running services.
3. Restart `npm run dev` so the Next.js client reloads with the new environment variables.
