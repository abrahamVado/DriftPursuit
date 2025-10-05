import { HudController } from "../hud/controller"
import type { EventStreamClient } from "@client/eventStream"
import type { ConnectionStatus } from "../networking/WebSocketClient"
import { createSandboxHudSession } from "./sandboxSession"

export interface HudSession {
  //1.- Connected world session exposing telemetry getters for HUD metrics.
  client: EventTarget & {
    getConnectionStatus(): ConnectionStatus
    getPlaybackBufferMs(): number
  }
  //2.- Optional scoreboard event stream wired when the broker advertises support.
  eventStream?: EventStreamClient
  //3.- Disposal hook allowing the shell to release networking resources during teardown.
  dispose?: () => void
}

export interface ClientShellOptions {
  //1.- Optional override used by tests to inject a custom document implementation.
  document?: Document
  //2.- Broker endpoint enables future networking setup without hardcoding environment globals.
  brokerUrl?: string
  //3.- Asynchronous world session factory invoked once DOM anchors are ready.
  createWorldSession?: () => Promise<HudSession>
}

class PassiveHudClient extends EventTarget {
  //1.- Surface a stable disconnected state so HUD widgets render predictable fallbacks.
  getConnectionStatus(): ConnectionStatus {
    return "disconnected"
  }

  //2.- Report a zero playback buffer because no transport session is active yet.
  getPlaybackBufferMs(): number {
    return 0
  }
}

class RendererController {
  private readonly canvas: HTMLCanvasElement

  constructor(root: HTMLElement) {
    //1.- Materialise a canvas so three.js integrations have a deterministic mount target.
    const doc = root.ownerDocument ?? document
    this.canvas = doc.createElement("canvas")
    this.canvas.dataset.role = "world-canvas"
    root.appendChild(this.canvas)
  }

  getCanvas(): HTMLCanvasElement {
    //1.- Surface the created canvas so sandbox integrations can attach renderers.
    return this.canvas
  }

  dispose(): void {
    //1.- Remove the created canvas to avoid duplicate mounts across hot reloads.
    this.canvas.remove()
  }
}

interface ClientShellHandles {
  renderer: RendererController
  hud: HudController | null
  canvasRoot: HTMLElement
  hudRoot: HTMLElement
  sessionDispose?: () => void
}

let handles: ClientShellHandles | null = null
let pendingReadyListener: ((event: Event) => void) | null = null
let lastDocument: Document | null = null

async function instantiateControllers(doc: Document, options: ClientShellOptions): Promise<boolean> {
  //1.- Discover the canvas and HUD anchors while tolerating missing markup for graceful degradation.
  const canvasRoot = doc.querySelector<HTMLElement>("#canvas-root")
  const hudRoot = doc.querySelector<HTMLElement>("#hud-root")
  if (!canvasRoot || !hudRoot) {
    return false
  }
  //2.- Instantiate the renderer immediately so the canvas exists before the session resolves.
  const renderer = new RendererController(canvasRoot)
  const context: ClientShellHandles = { renderer, hud: null, canvasRoot, hudRoot }
  handles = context
  hudRoot.dataset.brokerUrl = options.brokerUrl ?? ""

  const attachHud = (session: HudSession): boolean => {
    if (handles !== context) {
      session.dispose?.()
      return false
    }
    context.hud = new HudController({
      root: hudRoot,
      client: session.client,
      eventStream: session.eventStream,
    })
    context.sessionDispose = session.dispose
    return true
  }

  const handleFailure = () => {
    //3.- Ensure partial mounts release resources when the session never materialises.
    context.sessionDispose?.()
    renderer.dispose()
    hudRoot.dataset.brokerUrl = ""
    if (handles === context) {
      handles = null
    }
  }

  const sessionFactory =
    options.createWorldSession ??
    (() =>
      createSandboxHudSession({
        canvas: renderer.getCanvas(),
        brokerUrl: options.brokerUrl,
      }))

  if (sessionFactory) {
    try {
      const session = await sessionFactory()
      if (!attachHud(session)) {
        handleFailure()
        return false
      }
      return true
    } catch (error) {
      //4.- Fall back to a passive HUD so the overlay remains interactive without telemetry.
      console.error("failed to initialise world session", error)
      if (!attachHud({ client: new PassiveHudClient() })) {
        handleFailure()
        return false
      }
      return true
    }
  }

  if (!attachHud({ client: new PassiveHudClient() })) {
    handleFailure()
    return false
  }
  return true
}

export async function mountClientShell(options: ClientShellOptions = {}): Promise<boolean> {
  //1.- Short-circuit when the shell is already active to keep side-effects idempotent.
  if (handles) {
    return true
  }
  const doc = options.document ?? document
  lastDocument = doc

  const mountNow = () => instantiateControllers(doc, options)

  if (doc.readyState === "loading") {
    //2.- Defer mounting until DOMContentLoaded guarantees anchors are present in the document.
    return new Promise((resolve) => {
      pendingReadyListener = async () => {
        pendingReadyListener = null
        try {
          resolve(await mountNow())
        } catch (error) {
          console.error("failed to mount client shell", error)
          resolve(false)
        }
      }
      doc.addEventListener("DOMContentLoaded", pendingReadyListener)
    })
  }
  //3.- Proceed immediately when the DOM is already parsed by the time the caller initialises the shell.
  try {
    return await mountNow()
  } catch (error) {
    console.error("failed to mount client shell", error)
    return false
  }
}

export function unmountClientShell(): void {
  //1.- Remove the DOMContentLoaded handler if the shell never progressed to mounting.
  if (pendingReadyListener && lastDocument) {
    lastDocument.removeEventListener("DOMContentLoaded", pendingReadyListener)
    pendingReadyListener = null
  }
  lastDocument = null
  if (!handles) {
    return
  }
  //2.- Dispose controllers so they can release DOM references and timers during teardown.
  handles.sessionDispose?.()
  handles.hud?.dispose()
  handles.renderer.dispose()
  handles.hudRoot.dataset.brokerUrl = ""
  handles = null
}

export function isClientShellMounted(): boolean {
  //1.- Expose a diagnostic helper for tests and debugging overlays.
  return handles !== null
}
