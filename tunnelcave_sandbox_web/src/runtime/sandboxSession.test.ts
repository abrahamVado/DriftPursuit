import { beforeEach, describe, expect, it, vi } from 'vitest'

const buildVehicle = vi.fn(() => ({
  rotation: { x: 0, y: 0 },
  position: { set: vi.fn() },
}))

vi.mock('../world/procedural/vehicles', () => ({
  buildVehicle,
}))

const rendererState: { renderers: any[] } = { renderers: [] }

class StubWebGLRenderer {
  canvas: HTMLCanvasElement
  disposed = false
  pixelRatio = 1
  size: { width: number; height: number; updateStyle: boolean } | null = null
  renders = 0

  constructor(options: { canvas: HTMLCanvasElement }) {
    this.canvas = options.canvas
    rendererState.renderers.push(this)
  }

  setPixelRatio(ratio: number): void {
    this.pixelRatio = ratio
  }

  setSize(width: number, height: number, updateStyle: boolean): void {
    this.size = { width, height, updateStyle }
  }

  render(): void {
    this.renders += 1
  }

  dispose(): void {
    this.disposed = true
  }
}

class StubScene {
  background: unknown
  additions: any[] = []

  add(node: any): void {
    this.additions.push(node)
  }

  clear(): void {
    this.additions = []
  }
}

class StubPerspectiveCamera {
  aspect = 1
  position = { set: vi.fn() }
  lookAt = vi.fn()
  updateProjectionMatrix = vi.fn()
}

class StubLight {
  position = { set: vi.fn() }
  castShadow = false
}

class StubClock {
  elapsedTime = 0

  getDelta(): number {
    this.elapsedTime += 0.016
    return 0.016
  }
}

class StubVector3 {
  constructor(public x: number, public y: number, public z: number) {}
}

vi.mock('three', () => ({
  AmbientLight: StubLight,
  Clock: StubClock,
  Color: class {
    constructor(public value: number) {}
  },
  DirectionalLight: StubLight,
  PerspectiveCamera: StubPerspectiveCamera,
  Scene: StubScene,
  Vector3: StubVector3,
  WebGLRenderer: StubWebGLRenderer,
  __sandbox: rendererState,
}))

describe('sandboxSession', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    rendererState.renderers = []
  })

  it('creates a passive HUD session when no broker URL is provided', async () => {
    const { createSandboxHudSession } = await import('./sandboxSession')
    const canvas = document.createElement('canvas')
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      if (requestAnimationFrame.mock.calls.length <= 1) {
        callback(16)
      }
      return 42
    })
    const cancelAnimationFrame = vi.fn()

    const session = await createSandboxHudSession({ canvas, requestAnimationFrame, cancelAnimationFrame })
    expect(session.client.getConnectionStatus()).toBe('disconnected')
    expect(buildVehicle).toHaveBeenCalledWith('arrowhead')
    expect(rendererState.renderers).toHaveLength(1)

    session.dispose?.()

    expect(cancelAnimationFrame).toHaveBeenCalledWith(42)
    expect(rendererState.renderers[0]?.disposed).toBe(true)
  })

  it('connects to the broker when a URL is supplied', async () => {
    const { createSandboxHudSession } = await import('./sandboxSession')
    const canvas = document.createElement('canvas')
    const requestAnimationFrame = vi.fn(() => 7)
    const cancelAnimationFrame = vi.fn()
    const connect = vi.fn(async () => undefined)
    const disconnect = vi.fn()
    const dispose = vi.fn()
    const client = new (class extends EventTarget {
      getConnectionStatus() {
        return 'connected' as const
      }
      getPlaybackBufferMs() {
        return 120
      }
    })()

    const createWorldSession = vi.fn(() => ({
      connect,
      disconnect,
      dispose,
      client,
    }))

    const session = await createSandboxHudSession(
      { canvas, brokerUrl: 'ws://localhost:43127/ws', requestAnimationFrame, cancelAnimationFrame },
      { createWorldSession },
    )

    expect(createWorldSession).toHaveBeenCalledTimes(1)
    const dial = createWorldSession.mock.calls[0]?.[0]?.dial
    expect(dial.url).toBe('ws://localhost:43127/ws')
    expect(dial.auth.subject).toBe('sandbox-player')
    expect(connect).toHaveBeenCalledTimes(1)
    expect(session.client).toBe(client)

    session.dispose?.()

    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('builds dial options with environment overrides', async () => {
    const { buildDialOptions } = await import('./sandboxSession')
    process.env.NEXT_PUBLIC_BROKER_SUBJECT = ' pilot '
    process.env.NEXT_PUBLIC_BROKER_TOKEN = ' token '
    process.env.NEXT_PUBLIC_BROKER_PROTOCOLS = 'proto1, proto2'

    const dial = buildDialOptions('ws://example.test/ws')
    expect(dial.auth.subject).toBe('pilot')
    expect(dial.auth.token).toBe('token')
    expect(dial.protocols).toEqual(['proto1', 'proto2'])

    delete process.env.NEXT_PUBLIC_BROKER_SUBJECT
    delete process.env.NEXT_PUBLIC_BROKER_TOKEN
    delete process.env.NEXT_PUBLIC_BROKER_PROTOCOLS
  })
})
