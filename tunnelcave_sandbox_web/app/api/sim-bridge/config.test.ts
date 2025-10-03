import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { missingBridgeConfigMessage, resolveBridgeBaseUrl } from './config'

describe('resolveBridgeBaseUrl', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    //1.- Clear the bridge configuration variables so each test controls the environment explicitly.
    delete process.env.SIM_BRIDGE_URL
    delete process.env.NEXT_PUBLIC_SIM_BRIDGE_URL
  })

  afterEach(() => {
    //1.- Restore the environment after each test to avoid polluting unrelated suites.
    process.env = { ...originalEnv }
  })

  it('prefers the private SIM_BRIDGE_URL when present', () => {
    process.env.SIM_BRIDGE_URL = ' http://broker:9000 '
    process.env.NEXT_PUBLIC_SIM_BRIDGE_URL = 'http://public.example'

    const result = resolveBridgeBaseUrl()

    expect(result).toBe('http://broker:9000')
  })

  it('falls back to the public Next.js configuration key', () => {
    process.env.NEXT_PUBLIC_SIM_BRIDGE_URL = ' http://localhost:8000 '

    const result = resolveBridgeBaseUrl()

    expect(result).toBe('http://localhost:8000')
  })

  it('returns an empty string when neither key is configured', () => {
    const result = resolveBridgeBaseUrl()

    expect(result).toBe('')
  })
})

describe('missingBridgeConfigMessage', () => {
  it('provides actionable setup guidance', () => {
    const message = missingBridgeConfigMessage()

    expect(message).toContain('SIM_BRIDGE_URL')
    expect(message).toContain('NEXT_PUBLIC_SIM_BRIDGE_URL')
    expect(message).toContain('http://localhost:8000')
  })
})
