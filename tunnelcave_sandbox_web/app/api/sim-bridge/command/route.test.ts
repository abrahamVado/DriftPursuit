import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from './route'

const originalEnv = { ...process.env }
const originalFetch = global.fetch

describe('sim-bridge command route', () => {
  beforeEach(() => {
    //1.- Reset the bridge URL configuration and install a fetch mock per scenario.
    delete process.env.SIM_BRIDGE_URL
    delete process.env.NEXT_PUBLIC_SIM_BRIDGE_URL
    global.fetch = vi.fn() as unknown as typeof global.fetch
  })

  afterEach(() => {
    //1.- Restore the global environment after each test to prevent cross-test pollution.
    process.env = { ...originalEnv }
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('rejects commands when no bridge URL has been configured', async () => {
    const request = new Request('http://localhost/api/sim-bridge/command', {
      method: 'POST',
      body: JSON.stringify({ command: 'throttle' }),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.message).toContain('SIM_BRIDGE_URL')
  })

  it('forwards commands to the configured bridge', async () => {
    process.env.SIM_BRIDGE_URL = 'http://backend:9000'
    const upstreamResponse = { status: 'ok', command: { command: 'throttle' } }
    const fetchMock = vi.fn().mockResolvedValueOnce({
      status: 200,
      json: async () => upstreamResponse,
    })
    global.fetch = fetchMock as unknown as typeof global.fetch

    const request = new Request('http://localhost/api/sim-bridge/command', {
      method: 'POST',
      body: JSON.stringify({ command: 'throttle', issuedAtMs: 123 }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request)
    const body = await response.json()

    expect(fetchMock).toHaveBeenCalledWith('http://backend:9000/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'throttle', issuedAtMs: 123 }),
    })
    expect(response.status).toBe(200)
    expect(body).toEqual(upstreamResponse)
  })

  it('reports gateway errors when the upstream request fails with actionable tips', async () => {
    process.env.NEXT_PUBLIC_SIM_BRIDGE_URL = 'http://localhost:8000'
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('fetch failed', { cause: { code: 'ECONNREFUSED' } }))
    global.fetch = fetchMock as unknown as typeof global.fetch

    const request = new Request('http://localhost/api/sim-bridge/command', {
      method: 'POST',
      body: JSON.stringify({ command: 'brake' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body.message).toContain('Failed to forward command to simulation bridge at http://localhost:8000')
    expect(body.message).toContain('Ensure the simulation bridge service is running')
    expect(body.message).toContain('host.docker.internal')
  })
})
