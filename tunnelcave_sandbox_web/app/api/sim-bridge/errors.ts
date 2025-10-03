export type BridgeErrorCause = {
  code?: string
}

export type BridgeError = Error & {
  cause?: BridgeErrorCause
}

function extractCauseCode(error: unknown): string {
  //1.- Narrow the error type to inspect the optional cause exposed by the Fetch API.
  if (!(error instanceof Error)) {
    return ''
  }
  const candidate = (error as BridgeError).cause
  if (!candidate || typeof candidate.code !== 'string') {
    return ''
  }
  return candidate.code
}

function needsContainerHint(url: string): boolean {
  //1.- Attempt to parse the upstream URL so we can inspect the hostname for localhost patterns.
  try {
    const parsed = new URL(url)
    //2.- Flag loopback hosts because they often require host.docker.internal when Next.js runs inside Docker.
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  } catch (_error) {
    return false
  }
}

export function bridgeTroubleshootingSuffix(baseUrl: string, error: unknown): string {
  //1.- Build a list of actionable hints tailored to the failure mode and deployment topology.
  const hints: string[] = []
  const code = extractCauseCode(error)
  if (code === 'ECONNREFUSED') {
    hints.push('Ensure the simulation bridge service is running and accepting connections.')
  }
  if (code === 'ENOTFOUND') {
    hints.push('Verify the hostname resolves from the Next.js environment and matches your bridge deployment.')
  }
  if (needsContainerHint(baseUrl)) {
    hints.push(
      'If Next.js runs inside Docker while the bridge runs on your host, set SIM_BRIDGE_URL to http://host.docker.internal:8000.',
    )
  }
  //2.- Return a space-prefixed suffix that callers can append to their error messages.
  if (hints.length === 0) {
    return ''
  }
  return ` ${hints.join(' ')}`
}
