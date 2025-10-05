import { beforeEach, describe, expect, it, vi } from 'vitest'

const buildVehicle = vi.fn(() => ({
  rotation: { x: 0, y: 0 },
  position: { set: vi.fn() },
}))

vi.mock('../world/procedural/vehicles', () => ({
  buildVehicle,
  VEHICLE_PRESETS: { arrowhead: {}, aurora: {}, duskfall: {}, steelwing: {} },
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
      {
        //1.- Provide the sandbox options with a broker URL, lobby-selected pilot handle, and vehicle preset.
        canvas,
        brokerUrl: 'ws://localhost:43127/ws',
        requestAnimationFrame,
        cancelAnimationFrame,
        pilotName: 'Ace Pilot',
        vehicleId: 'aurora',
      },
      { createWorldSession },
    )

    expect(createWorldSession).toHaveBeenCalledTimes(1)
    const dial = createWorldSession.mock.calls[0]?.[0]?.dial
    expect(dial.url).toBe('ws://localhost:43127/ws')
    expect(dial.auth.subject).toBe('ace-pilot')
    expect(connect).toHaveBeenCalledTimes(1)
    expect(session.client).toBe(client)

    session.dispose?.()

    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('falls back to the default vehicle preset when an unknown selection is provided', async () => {
    const { createSandboxHudSession } = await import('./sandboxSession')
    const canvas = document.createElement('canvas')
    const requestAnimationFrame = vi.fn(() => 1)
    const cancelAnimationFrame = vi.fn()

    await createSandboxHudSession({
      //2.- Pass an invalid preset identifier to exercise the fallback path.
      canvas,
      requestAnimationFrame,
      cancelAnimationFrame,
      vehicleId: 'unknown' as any,
    })

    expect(buildVehicle).toHaveBeenCalledWith('arrowhead')
  })

  it('builds dial options with environment overrides', async () => {
    const { buildDialOptions } = await import('./sandboxSession')
    process.env.NEXT_PUBLIC_BROKER_SUBJECT = ' pilot '
    process.env.NEXT_PUBLIC_BROKER_TOKEN = ' token '
    process.env.NEXT_PUBLIC_BROKER_PROTOCOLS = 'proto1, proto2'

    const dial = buildDialOptions('ws://example.test/ws', { subject: ' Skye Runner ' })
    expect(dial.auth.subject).toBe('skye-runner')
    expect(dial.auth.token).toBe('token')
    expect(dial.protocols).toEqual(['proto1', 'proto2'])

    delete process.env.NEXT_PUBLIC_BROKER_SUBJECT
    delete process.env.NEXT_PUBLIC_BROKER_TOKEN
    delete process.env.NEXT_PUBLIC_BROKER_PROTOCOLS
  })

  it('polyfills requestAnimationFrame with timeout backed handles when unavailable', async () => {
    const { createSandboxHudSession } = await import('./sandboxSession')
    const canvas = document.createElement('canvas')
    const browserWindow = window as unknown as Record<string, any>
    const originalRequest = browserWindow.requestAnimationFrame
    const originalCancel = browserWindow.cancelAnimationFrame
    browserWindow.requestAnimationFrame = undefined
    browserWindow.cancelAnimationFrame = undefined

    const handles: ReturnType<typeof globalThis.setTimeout>[] = []
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((...args: Parameters<typeof globalThis.setTimeout>) => {
        //1.- Capture scheduled callbacks to assert that the timeout based polyfill is used.
        const [callback] = args
        if (typeof callback === 'function') {
          //2.- We do not invoke the callback to keep the render loop paused during the test.
        }
        const handle = { id: handles.length } as unknown as ReturnType<typeof globalThis.setTimeout>
        handles.push(handle)
        return handle
      }) as typeof globalThis.setTimeout)

    const cleared: ReturnType<typeof globalThis.setTimeout>[] = []
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation(((handle: ReturnType<typeof globalThis.setTimeout>) => {
        //3.- Track cleared handles so we can ensure the polyfill wires through to clearTimeout correctly.
        cleared.push(handle)
      }) as typeof globalThis.clearTimeout)

    try {
      const session = await createSandboxHudSession({ canvas })
      expect(setTimeoutSpy).toHaveBeenCalled()
      expect(handles).toHaveLength(1)

      session.dispose?.()

      expect(clearTimeoutSpy).toHaveBeenCalledWith(handles[0])
      expect(cleared).toContain(handles[0])
    } finally {
      setTimeoutSpy.mockRestore()
      clearTimeoutSpy.mockRestore()
      browserWindow.requestAnimationFrame = originalRequest
      browserWindow.cancelAnimationFrame = originalCancel
    }
  })
})
