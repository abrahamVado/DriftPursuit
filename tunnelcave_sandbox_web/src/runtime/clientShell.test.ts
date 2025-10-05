import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hudConstructor = vi.fn()
const hudDisposer = vi.fn()
const sandboxSession = vi.fn(async () => ({
  client: new (class extends EventTarget {
    getConnectionStatus() {
      return 'disconnected' as const
    }
    getPlaybackBufferMs() {
      return 0
    }
  })(),
}))

vi.mock('../hud/controller', () => ({
  HudController: vi.fn().mockImplementation((options) => {
    hudConstructor(options)
    return { dispose: hudDisposer }
  }),
}))

vi.mock('./sandboxSession', () => ({
  createSandboxHudSession: sandboxSession,
}))

const originalReadyStateDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'readyState')

describe('clientShell', () => {
  beforeEach(() => {
    //1.- Reset module isolation and DOM scaffolding between tests.
    vi.resetModules()
    hudConstructor.mockClear()
    hudDisposer.mockClear()
    sandboxSession.mockClear()
    document.body.innerHTML = ''
    if (originalReadyStateDescriptor) {
      Object.defineProperty(document, 'readyState', originalReadyStateDescriptor)
    }
  })

  afterEach(() => {
    //1.- Restore the native readyState descriptor so other suites observe browser defaults.
    if (originalReadyStateDescriptor) {
      Object.defineProperty(document, 'readyState', originalReadyStateDescriptor)
    }
    document.body.innerHTML = ''
  })

  it('mounts the renderer and HUD controllers once anchors are ready', async () => {
    document.body.innerHTML = [
      '<div id="canvas-root"></div>',
      '<div id="hud-root"></div>',
    ].join('')
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'loading' })
    const module = await import('./clientShell')
    const dispose = vi.fn()
    const sessionClient = new (class extends EventTarget {
      getConnectionStatus() {
        return 'connected' as const
      }
      getPlaybackBufferMs() {
        return 0
      }
    })()
    const createWorldSession = vi.fn(async () => ({ client: sessionClient, dispose }))
    const mountPromise = module.mountClientShell({
      brokerUrl: 'ws://localhost:43127/ws',
      createWorldSession,
    })
    document.dispatchEvent(new Event('DOMContentLoaded'))
    const mounted = await mountPromise
    expect(mounted).toBe('active')
    expect(module.isClientShellMounted()).toBe(true)
    expect(createWorldSession).toHaveBeenCalledTimes(1)
    expect(sandboxSession).not.toHaveBeenCalled()
    expect(hudConstructor).toHaveBeenCalledTimes(1)
    expect(hudConstructor.mock.calls[0]?.[0]?.client).toBe(sessionClient)
    const hudRoot = document.getElementById('hud-root') as HTMLDivElement
    expect(hudRoot.dataset.brokerUrl).toBe('ws://localhost:43127/ws')
    const canvas = document.querySelector('#canvas-root canvas[data-role="world-canvas"]')
    expect(canvas).not.toBeNull()
    module.unmountClientShell()
    expect(hudDisposer).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(hudRoot.dataset.brokerUrl).toBe('')
    expect(module.isClientShellMounted()).toBe(false)
  })

  it('skips mounting when anchors are missing', async () => {
    document.body.innerHTML = '<div id="canvas-root"></div>'
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' })
    const module = await import('./clientShell')
    const mounted = await module.mountClientShell()
    expect(mounted).toBe('passive')
    expect(module.isClientShellMounted()).toBe(false)
    expect(hudConstructor).not.toHaveBeenCalled()
    expect(sandboxSession).not.toHaveBeenCalled()
  })
})
