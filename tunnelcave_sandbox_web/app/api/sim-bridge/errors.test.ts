import { describe, expect, it } from 'vitest'

import { bridgeTroubleshootingSuffix } from './errors'

describe('bridgeTroubleshootingSuffix', () => {
  it('suggests starting the bridge when the connection is refused', () => {
    const error = new Error('fetch failed', { cause: { code: 'ECONNREFUSED' } })

    const suffix = bridgeTroubleshootingSuffix('http://localhost:8000', error)

    expect(suffix).toContain('Ensure the simulation bridge service is running')
    expect(suffix).toContain('host.docker.internal')
  })

  it('advises checking DNS when the host is unknown', () => {
    const error = new Error('fetch failed', { cause: { code: 'ENOTFOUND' } })

    const suffix = bridgeTroubleshootingSuffix('http://backend:9000', error)

    expect(suffix).toContain('Verify the hostname resolves')
    expect(suffix).not.toContain('host.docker.internal')
  })

  it('returns an empty suffix when no actionable hints apply', () => {
    const suffix = bridgeTroubleshootingSuffix('http://backend:9000', new Error('boom'))

    expect(suffix).toBe('')
  })
})
