# Visualizer Operations Guide

This runbook explains how to bring up the full Drift Pursuit visualizer stack on a local workstation: the Go broker streams
telemetry, the Python HTTP bridge exposes simulation controls, and the Next.js client renders the sandbox UI. Follow each
section in order to ensure the three services share credentials and network bindings.

## Prerequisites
- **Go 1.24.x** (matches the `toolchain go1.24.3` directive in `go-broker/go.mod`).
- **Python 3.11+** with `pip` available for managing the bridge dependencies.
- **Node.js 20.x** with `corepack` enabled so pnpm 10.18.x can be activated (see `docs/visualizer_setup/README.md`).
- **pnpm 10.18.x** (`corepack use pnpm@10.18.0`) for the Next.js workspace.
- **Environment ports** `43127` (WebSocket broker) and `8000` (HTTP bridge) must be free.

## 1. Launch the Go broker
1. Export the minimum secrets expected by the configuration loader:
   ```bash
   export BROKER_GRPC_SHARED_SECRET="local-dev-secret"
   export BROKER_WS_AUTH_MODE="disabled"         # optional because this is already the default
   ```
2. Start the broker from the repository root (the listener defaults to `:43127` as defined in `internal/config/config.go`):
   ```bash
   cd go-broker
   go run .
   ```
3. Verify the WebSocket listener is ready:
   ```bash
   curl -i http://localhost:43127/healthz || true
   ```
   The `/healthz` handler defined in `go-broker/main.go` returns a JSON payload with `status: "ok"` once the broker finishes
   its startup sequence.

## 2. Start the Python simulation bridge
1. Create an isolated environment and install the lightweight tooling needed for tests:
   ```bash
   cd python-sim
   python -m venv .venv
   source .venv/bin/activate
   pip install --upgrade pip
   pip install pytest
   ```
   The repository modules are pure Python, so setting `PYTHONPATH` to the workspace is sufficient for imports; `pytest` is the
   only external dependency required by the existing test suites.
2. Run the bridge server with the default state provider on port `8000`:
   ```bash
   export PYTHONPATH="${PWD}"
   python -m web_bridge.server
   ```
3. Confirm the handshake endpoint responds:
   ```bash
   curl http://localhost:8000/handshake
   ```
   Expect a JSON payload similar to `{ "status": "ok", "message": "Simulation bridge online" }` as defined in
   `python-sim/web_bridge/server.py`.

## 3. Configure and run the Next.js visualizer client
1. Install dependencies with pnpm:
   ```bash
   cd tunnelcave_sandbox_web
   corepack enable pnpm
   pnpm install
   ```
2. Scaffold `.env.local` with broker endpoints:
   ```bash
   ../scripts/setup-env.sh --force
   ```
   The generated file defines `NEXT_PUBLIC_BROKER_URL=ws://localhost:43127/ws`,
   `SIM_BRIDGE_URL=http://localhost:8000`, and
   `NEXT_PUBLIC_SIM_BRIDGE_URL=http://localhost:8000` so both the proxy and the browser can reach the bridge.
3. Launch the development server:
   ```bash
   pnpm dev
   ```
4. Open `http://localhost:3000` in a browser. The client bootstrap (`app/components/ClientBootstrap.tsx`) will surface an
   inline warning if either environment variable is missing.

## 4. Optional smoke-test screenshot
Once the UI is reachable, the Playwright script at `tunnelcave_sandbox_web/test/smoke/visual-smoke.spec.ts` can capture a
baseline screenshot for visual regression tracking:
```bash
cd tunnelcave_sandbox_web
npx playwright install --with-deps
pnpm exec playwright test test/smoke/visual-smoke.spec.ts
```
Set `VISUALIZER_BASE_URL` and `VISUALIZER_SMOKE_OUTPUT` to override the navigation target or screenshot path if needed.

## 5. Test expectations before merge
All automated suites must be green prior to merging changes:
- Run the Go unit suite: `cd go-broker && go test ./...`.
- Execute the Python bridge tests: `cd python-sim && pytest`.
- From `tunnelcave_sandbox_web`, ensure `pnpm test` passes so the networking mocks, procedural geometry, and UI interaction
  Vitest suites stay healthy.
- If the Playwright smoke test is updated, run `pnpm exec playwright test` as part of the review checklist.

Document successful runs (timestamps and commit hash) in your pull request description when promoting changes to the main
branch.
