import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GET } from './route'

const originalEnv = { ...process.env }
const originalFetch = global.fetch

describe('sim-bridge handshake route', () => {
  beforeEach(() => {
    //1.- Reset environment variables and install a deterministic fetch mock before each test.
    delete process.env.SIM_BRIDGE_URL
    delete process.env.NEXT_PUBLIC_SIM_BRIDGE_URL
    global.fetch = vi.fn() as unknown as typeof global.fetch
  })

  afterEach(() => {
    //1.- Restore environment variables and fetch implementation after each test case.
    process.env = { ...originalEnv }
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('returns a helpful error when the bridge URL is not configured', async () => {
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.message).toContain('SIM_BRIDGE_URL')
  })

  it('proxies the handshake request to the configured bridge', async () => {
    process.env.NEXT_PUBLIC_SIM_BRIDGE_URL = 'http://localhost:8000'
    const handshake = { status: 'ok', message: 'Simulation bridge online' }
    const fetchMock = vi.fn().mockResolvedValueOnce({
      status: 200,
      json: async () => handshake,
    })
    global.fetch = fetchMock as unknown as typeof global.fetch

    const response = await GET()
    const body = await response.json()

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8000/handshake', { cache: 'no-store' })
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ...handshake, bridgeUrl: 'http://localhost:8000' })
  })

  it('maps network failures to a gateway error with troubleshooting guidance', async () => {
    process.env.SIM_BRIDGE_URL = 'http://localhost:8000'
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('fetch failed', { cause: { code: 'ECONNREFUSED' } }))
    global.fetch = fetchMock as unknown as typeof global.fetch

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body.message).toContain('Failed to reach simulation bridge at http://localhost:8000')
    expect(body.message).toContain('Ensure the simulation bridge service is running')
    expect(body.message).toContain('host.docker.internal')
  })
})
