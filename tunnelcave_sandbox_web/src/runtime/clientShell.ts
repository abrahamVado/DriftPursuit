import { HudController } from "../hud/controller"
import type { ConnectionStatus } from "../networking/WebSocketClient"

export interface ClientShellOptions {
  //1.- Optional override used by tests to inject a custom document implementation.
  document?: Document
  //2.- Broker endpoint enables future networking setup without hardcoding environment globals.
  brokerUrl?: string
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

  dispose(): void {
    //1.- Remove the created canvas to avoid duplicate mounts across hot reloads.
    this.canvas.remove()
  }
}

interface ClientShellHandles {
  renderer: RendererController
  hud: HudController
  canvasRoot: HTMLElement
  hudRoot: HTMLElement
}

let handles: ClientShellHandles | null = null
let pendingReadyListener: ((event: Event) => void) | null = null
let lastDocument: Document | null = null

function instantiateControllers(doc: Document, options: ClientShellOptions): boolean {
  //1.- Discover the canvas and HUD anchors while tolerating missing markup for graceful degradation.
  const canvasRoot = doc.querySelector<HTMLElement>("#canvas-root")
  const hudRoot = doc.querySelector<HTMLElement>("#hud-root")
  if (!canvasRoot || !hudRoot) {
    return false
  }
  //2.- Stand up the renderer and HUD controllers so the gameplay shell can render telemetry.
  const renderer = new RendererController(canvasRoot)
  const hud = new HudController({ root: hudRoot, client: new PassiveHudClient() })
  if (options.brokerUrl) {
    //3.- Surface the configured broker URL for debugging overlays via a data attribute.
    hudRoot.dataset.brokerUrl = options.brokerUrl
  }
  handles = { renderer, hud, canvasRoot, hudRoot }
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
      pendingReadyListener = () => {
        pendingReadyListener = null
        resolve(mountNow())
      }
      doc.addEventListener("DOMContentLoaded", pendingReadyListener)
    })
  }
  //3.- Proceed immediately when the DOM is already parsed by the time the caller initialises the shell.
  return mountNow()
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
  handles.hud.dispose()
  handles.renderer.dispose()
  handles.hudRoot.dataset.brokerUrl = ""
  handles = null
}

export function isClientShellMounted(): boolean {
  //1.- Expose a diagnostic helper for tests and debugging overlays.
  return handles !== null
}
