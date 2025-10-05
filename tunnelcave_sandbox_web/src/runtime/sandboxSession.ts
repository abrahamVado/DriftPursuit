import type { ClientShellMountResult, HudSession } from './clientShell'
import type { ConnectionStatus } from '../networking/WebSocketClient'
import type { SocketDialOptions } from '../networking/authenticatedSocket'
import { createWorldSession, type WorldSessionHandle } from '@client/networking/worldSession'
import { buildVehicle, VEHICLE_PRESETS, type VehiclePresetName } from '../world/procedural/vehicles'
import {
  AmbientLight,
  Clock,
  Color,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'

//1.- SandboxHudClient mirrors the passive HUD client but remains local to the sandbox module.
class SandboxHudClient extends EventTarget {
  private status: ConnectionStatus = 'disconnected'
  private bufferMs = 0

  setStatus(status: ConnectionStatus): void {
    if (this.status === status) {
      return
    }
    this.status = status
    this.dispatchEvent(new CustomEvent<ConnectionStatus>('status', { detail: status }))
  }

  getConnectionStatus(): ConnectionStatus {
    return this.status
  }

  setPlaybackBufferMs(bufferMs: number): void {
    this.bufferMs = bufferMs
  }

  getPlaybackBufferMs(): number {
    return this.bufferMs
  }
}

export interface SandboxSessionOptions {
  //1.- Canvas the renderer should draw into.
  canvas: HTMLCanvasElement
  //2.- Optional broker endpoint for live telemetry connections.
  brokerUrl?: string
  //3.- Optional broker subject override used to group pilots into a shared world.
  brokerSubject?: string
  //4.- Optional window override to support deterministic tests.
  window?: Window
  //5.- Optional frame scheduler overrides so tests can inject fake timers.
  requestAnimationFrame?: (callback: FrameRequestCallback) => number
  cancelAnimationFrame?: (handle: number) => void
  //6.- Optional pilot handle collected from the lobby for personalised HUD context.
  pilotName?: string
  //7.- Optional vehicle preset identifier chosen from the interactive lobby.
  vehicleId?: VehiclePresetName
}

export interface SandboxDependencies {
  //1.- Allow tests to substitute the world session factory without loading networking stacks.
  createWorldSession?: typeof createWorldSession
}

interface SandboxWorldHandles {
  renderer: WebGLRenderer
  camera: PerspectiveCamera
  scene: Scene
  vehicle: ReturnType<typeof buildVehicle>
  clock: Clock
  frameHandle: number | null
  resizeListener?: () => void
}

const DEFAULT_BACKGROUND = 0x050714
const DEFAULT_SUBJECT = 'sandbox-player'
const FALLBACK_VEHICLE: VehiclePresetName = 'arrowhead'

function normaliseSubject(candidate: string | undefined): string {
  //1.- Lowercase and dash-separate the pilot name so broker subjects remain URL safe.
  const trimmed = candidate?.trim() ?? ''
  if (!trimmed) {
    return DEFAULT_SUBJECT
  }
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || DEFAULT_SUBJECT
}

function resolveVehicleSelection(vehicleId: string | undefined): VehiclePresetName {
  //1.- Fall back to the default preset when the selection is missing or unknown.
  if (!vehicleId) {
    return FALLBACK_VEHICLE
  }
  const normalised = vehicleId.trim().toLowerCase() as VehiclePresetName
  if (Object.prototype.hasOwnProperty.call(VEHICLE_PRESETS, normalised)) {
    return normalised
  }
  return FALLBACK_VEHICLE
}

function resolveWindow(options: SandboxSessionOptions): Window | typeof globalThis {
  //1.- Prefer an explicit override, fall back to the owner document window, then globalThis.
  if (options.window) {
    return options.window
  }
  const doc = options.canvas.ownerDocument
  if (doc && doc.defaultView) {
    return doc.defaultView
  }
  return globalThis
}

function resolveAuth(subjectOverride?: string): SocketDialOptions['auth'] {
  //1.- Normalise optional string environment variables and apply sensible defaults for local play.
  const subjectCandidate = subjectOverride ?? process.env.NEXT_PUBLIC_BROKER_SUBJECT ?? DEFAULT_SUBJECT
  const subject = normaliseSubject(subjectCandidate)
  const token = process.env.NEXT_PUBLIC_BROKER_TOKEN?.trim()
  const secret = process.env.NEXT_PUBLIC_BROKER_SECRET?.trim()
  const audience = process.env.NEXT_PUBLIC_BROKER_AUDIENCE?.trim()
  const ttlRaw = process.env.NEXT_PUBLIC_BROKER_TTL_SECONDS?.trim()
  const ttlSeconds = ttlRaw ? Number.parseInt(ttlRaw, 10) : undefined

  const auth: SocketDialOptions['auth'] = { subject }
  if (audience) {
    auth.audience = audience
  }
  if (Number.isFinite(ttlSeconds ?? NaN)) {
    auth.ttlSeconds = ttlSeconds
  }
  if (token) {
    auth.token = token
    return auth
  }
  if (secret) {
    auth.secret = secret
    return auth
  }
  auth.token = `sandbox-${subject}`
  return auth
}

function resolveProtocols(): SocketDialOptions['protocols'] | undefined {
  //1.- Allow developers to opt into custom subprotocols via comma separated env configuration.
  const raw = process.env.NEXT_PUBLIC_BROKER_PROTOCOLS?.trim()
  if (!raw) {
    return undefined
  }
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  if (entries.length === 0) {
    return undefined
  }
  return entries.length === 1 ? entries[0] : entries
}

function configureRenderer(
  options: SandboxSessionOptions,
  scheduler: Required<Pick<SandboxSessionOptions, 'requestAnimationFrame' | 'cancelAnimationFrame'>>,
  win: Window | typeof globalThis,
  vehiclePreset: VehiclePresetName,
): SandboxWorldHandles {
  //1.- Create the renderer with anti-aliasing so the craft looks smooth even on large displays.
  const renderer = new WebGLRenderer({ canvas: options.canvas, antialias: true })
  const pixelRatio = (win as Window).devicePixelRatio ?? 1
  renderer.setPixelRatio(pixelRatio)

  const scene = new Scene()
  scene.background = new Color(DEFAULT_BACKGROUND)

  const camera = new PerspectiveCamera(60, 1, 0.1, 2000)
  camera.position.set(12, 7, 14)
  camera.lookAt(new Vector3(0, 0, 0))

  const ambient = new AmbientLight(0xffffff, 0.6)
  const directional = new DirectionalLight(0xffeed1, 1.4)
  directional.position.set(16, 20, 12)
  directional.castShadow = false
  scene.add(ambient)
  scene.add(directional)

  const vehicle = buildVehicle(vehiclePreset)
  vehicle.position.set(0, 0, 0)
  scene.add(vehicle)

  const clock = new Clock()
  let frameHandle: number | null = null

  const resize = () => {
    //1.- Keep the canvas resolution in sync with the layout box to avoid stretched renders.
    const width = options.canvas.clientWidth || ((win as Window).innerWidth ?? 1280)
    const height = options.canvas.clientHeight || ((win as Window).innerHeight ?? 720)
    camera.aspect = width / Math.max(1, height)
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
  }

  resize()

  const animate = () => {
    //1.- Rotate the craft and animate emissive rings to provide an idle showcase.
    const delta = clock.getDelta()
    vehicle.rotation.y += delta * 0.6
    vehicle.rotation.x = Math.sin(clock.elapsedTime * 0.25) * 0.1
    renderer.render(scene, camera)
    frameHandle = scheduler.requestAnimationFrame(animate)
  }

  frameHandle = scheduler.requestAnimationFrame(animate)

  const handles: SandboxWorldHandles = {
    renderer,
    camera,
    scene,
    vehicle,
    clock,
    frameHandle,
  }

  if (typeof (win as Window).addEventListener === 'function') {
    const listener = () => resize()
    ;(win as Window).addEventListener('resize', listener)
    handles.resizeListener = listener
  }

  return handles
}

function disposeWorld(
  handles: SandboxWorldHandles,
  scheduler: Required<Pick<SandboxSessionOptions, 'requestAnimationFrame' | 'cancelAnimationFrame'>>,
  win: Window | typeof globalThis,
): void {
  //1.- Cancel the active animation frame so the render loop stops immediately.
  if (handles.frameHandle !== null) {
    scheduler.cancelAnimationFrame(handles.frameHandle)
    handles.frameHandle = null
  }
  //2.- Remove resize listeners to avoid leaks across hot reloads.
  if (handles.resizeListener && typeof (win as Window).removeEventListener === 'function') {
    ;(win as Window).removeEventListener('resize', handles.resizeListener)
  }
  //3.- Clear the scene graph and dispose renderer resources.
  handles.scene.clear()
  handles.renderer.dispose()
}

export function buildDialOptions(url: string, overrides?: { subject?: string }): SocketDialOptions {
  //1.- Combine the broker URL with auth and protocol overrides to produce the dial options.
  return {
    url,
    protocols: resolveProtocols(),
    auth: resolveAuth(overrides?.subject),
  }
}

export async function createSandboxHudSession(
  options: SandboxSessionOptions,
  dependencies: SandboxDependencies = {},
): Promise<HudSession> {
  //1.- Resolve the host window and animation scheduler utilities.
  const win = resolveWindow(options)
  //1.- Normalise timer helpers so the polyfill can leverage whichever environment is available.
  const timeoutFn: typeof globalThis.setTimeout =
    typeof (win as Window & typeof globalThis).setTimeout === 'function'
      ? (win as Window & typeof globalThis).setTimeout.bind(win)
      : globalThis.setTimeout
  const clearTimeoutFn: typeof globalThis.clearTimeout =
    typeof (win as Window & typeof globalThis).clearTimeout === 'function'
      ? (win as Window & typeof globalThis).clearTimeout.bind(win)
      : globalThis.clearTimeout
  let frameHandleSeed = 0
  const timeoutHandles = new Map<number, ReturnType<typeof timeoutFn>>()
  const requestFrame =
    options.requestAnimationFrame ??
    (typeof (win as Window).requestAnimationFrame === 'function'
      ? (win as Window).requestAnimationFrame.bind(win)
      : (callback: FrameRequestCallback) => {
          //2.- Use numeric identifiers that mirror the browser API and back them with real timeout handles.
          const handle = ++frameHandleSeed
          const timeoutHandle = timeoutFn(() => {
            timeoutHandles.delete(handle)
            callback(Date.now())
          }, 16)
          timeoutHandles.set(handle, timeoutHandle)
          return handle
        })
  const cancelFrame =
    options.cancelAnimationFrame ??
    (typeof (win as Window).cancelAnimationFrame === 'function'
      ? (win as Window).cancelAnimationFrame.bind(win)
      : (handle: number) => {
          //3.- Look up the underlying timeout handle and clear it to keep the polyfill leak free.
          const timeoutHandle = timeoutHandles.get(handle)
          if (timeoutHandle !== undefined) {
            clearTimeoutFn(timeoutHandle)
            timeoutHandles.delete(handle)
          }
        })

  const scheduler: Required<Pick<SandboxSessionOptions, 'requestAnimationFrame' | 'cancelAnimationFrame'>> = {
    requestAnimationFrame: requestFrame,
    cancelAnimationFrame: cancelFrame,
  }

  const vehiclePreset = resolveVehicleSelection(options.vehicleId)
  const world = configureRenderer(options, scheduler, win, vehiclePreset)
  const passiveClient = new SandboxHudClient()

  let session: WorldSessionHandle | null = null
  let connectedClient: HudSession['client'] | null = null

  if (options.brokerUrl) {
    const factory = dependencies.createWorldSession ?? createWorldSession
    try {
      //2.- Instantiate the world session and establish a live connection when a broker URL is configured.
      session = factory({
        //3.- Honour explicit broker subject overrides so pilots can intentionally branch sessions.
        dial: buildDialOptions(
          options.brokerUrl,
          options.brokerSubject ? { subject: options.brokerSubject } : undefined,
        ),
      })
      passiveClient.setStatus('connecting')
      await session.connect()
      connectedClient = session.client
    } catch (error) {
      console.error('Failed to connect to broker session', error)
      session?.dispose()
      session = null
      passiveClient.setStatus('disconnected')
    }
  }

  const client = connectedClient ?? passiveClient
  const mode: ClientShellMountResult = connectedClient ? 'active' : 'passive'

  return {
    client,
    dispose: () => {
      //3.- Stop rendering, release world resources, and tear down the broker session if present.
      disposeWorld(world, scheduler, win)
      if (session) {
        session.disconnect()
        session.dispose()
      }
    },
    mode,
  }
}
