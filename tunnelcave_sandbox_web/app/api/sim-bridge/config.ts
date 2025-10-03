const BRIDGE_ENV_KEYS = ['SIM_BRIDGE_URL', 'NEXT_PUBLIC_SIM_BRIDGE_URL'] as const

type BridgeEnvKey = (typeof BRIDGE_ENV_KEYS)[number]

export function resolveBridgeBaseUrl(): string {
  //1.- Collect candidate values in priority order so private server-side configuration wins over client hints.
  const values: Array<string | undefined> = BRIDGE_ENV_KEYS.map((key: BridgeEnvKey) => process.env[key])
  //2.- Return the first non-empty, trimmed URL to preserve compatibility with both Next.js and backend services.
  for (const candidate of values) {
    const trimmed = candidate?.trim()
    if (trimmed) {
      return trimmed
    }
  }
  //3.- Fall back to an empty string when no environment variable has been configured.
  return ''
}

export function missingBridgeConfigMessage(): string {
  //1.- Provide actionable guidance so operators know which environment variables to set.
  const template =
    'Simulation bridge URL not configured. Set SIM_BRIDGE_URL or NEXT_PUBLIC_SIM_BRIDGE_URL (e.g. http://localhost:8000).'
  //2.- Return the advisory without trailing whitespace to keep logs clean.
  return template.trim()
}
