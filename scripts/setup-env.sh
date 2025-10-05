#!/usr/bin/env bash
set -euo pipefail

# //1.- Discover the repository root so the script works from any invocation directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TARGET_FILE="${REPO_ROOT}/tunnelcave_sandbox_web/.env.local"
BACKUP_FILE="${TARGET_FILE}.bak"

# //2.- Detect if the caller requested an overwrite via the --force flag.
OVERWRITE=false
if [[ "${1:-}" == "--force" ]]; then
  OVERWRITE=true
fi

# //3.- Ensure the Next.js workspace exists before attempting to scaffold.
if [[ ! -d "${REPO_ROOT}/tunnelcave_sandbox_web" ]]; then
  echo "error: tunnelcave_sandbox_web workspace not found" >&2
  exit 1
fi

# //4.- Guard against clobbering an existing configuration unless --force is provided.
if [[ -f "${TARGET_FILE}" && "${OVERWRITE}" != true ]]; then
  echo "Found existing .env.local at ${TARGET_FILE}. Pass --force to overwrite." >&2
  exit 0
fi

# //5.- Preserve the previous file so manual changes are not lost when overwriting.
if [[ -f "${TARGET_FILE}" ]]; then
  cp "${TARGET_FILE}" "${BACKUP_FILE}"
  echo "Backed up existing .env.local to ${BACKUP_FILE}."
fi

# //6.- Write the recommended defaults with inline documentation for future adjustments.
cat > "${TARGET_FILE}" <<'ENV_TEMPLATE'
# Drift Pursuit sandbox environment configuration.
# Update these values to point at your own services when not running locally.

# Websocket endpoint served by the broker (default docker-compose port 43127).
NEXT_PUBLIC_BROKER_URL=ws://localhost:43127/ws

# Server-side origin for the simulation bridge API proxy (default local bridge port 8000).
SIM_BRIDGE_URL=http://localhost:8000

# HTTP origin for the simulation bridge API (default local bridge port 8000).
NEXT_PUBLIC_SIM_BRIDGE_URL=http://localhost:8000
ENV_TEMPLATE

chmod 600 "${TARGET_FILE}"
echo "Scaffolded ${TARGET_FILE} with local development defaults."
