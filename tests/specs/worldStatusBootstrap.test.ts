import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createBrokerClient } from '@/lib/brokerClient'
import { createStreamer } from '@/world/chunks/streamer'
import { configureWorldSeeds, getWorldSeedSnapshot } from '@/world/chunks/worldSeed'
import { resetDifficultyState } from '@/engine/difficulty'

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  url: string
  sent: string[] = []
  private listeners: Map<string, Set<(event: any) => void>> = new Map()

  constructor(url: string) {
    //1.- Capture the constructor URL so assertions can confirm the client respects the resolved endpoint.
    this.url = url
    mockSockets.push(this)
  }

  addEventListener(type: string, handler: (event: any) => void) {
    //2.- Allow the broker client to register lifecycle handlers just like a real browser WebSocket.
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type)!.add(handler)
  }

  removeEventListener(type: string, handler: (event: any) => void) {
    //3.- Support listener removal for parity with the real DOM API.
    this.listeners.get(type)?.delete(handler)
  }

  send(payload: string) {
    //4.- Record outbound frames so tests can introspect handshake behaviour if required.
    this.sent.push(payload)
  }

  close() {
    //5.- Transition to the CLOSED state and notify observers so the client cleans up timers.
    if (this.readyState === MockWebSocket.CLOSED) return
    this.readyState = MockWebSocket.CLOSED
    this.dispatch('close', {})
  }

  open() {
    //6.- Simulate the broker acknowledging the connection so queued frames flush immediately.
    if (this.readyState !== MockWebSocket.CONNECTING) return
    this.readyState = MockWebSocket.OPEN
    this.dispatch('open', {})
  }

  emitMessage(data: string) {
    //7.- Deliver a payload to the client exactly as the browser would surface broker updates.
    this.dispatch('message', { data })
  }

  private dispatch(type: string, event: any) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event)
    }
  }
}

const mockSockets: MockWebSocket[] = []

export async function testWorldStatusBootstrap(): Promise<void> {
  //1.- Ensure deterministic defaults so the new snapshot emitted by the test is isolated.
  configureWorldSeeds()
  resetDifficultyState()

  const previousDocument = (globalThis as any).document
  if (!previousDocument) {
    //2.- Provide a barebones DOM shim for Three.js texture and canvas creation in the Node runtime.
    const factory = () => ({
      setAttribute: () => {},
      style: {},
      appendChild: () => {},
      addEventListener: () => {},
      removeEventListener: () => {}
    })
    ;(globalThis as any).document = {
      createElementNS: factory,
      createElement: factory
    } as unknown as Document
  }
  const previousImage = (globalThis as any).Image
  if (!previousImage) {
    ;(globalThis as any).Image = class {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      addEventListener(event: string, handler: () => void) {
        if (event === 'load') this.onload = handler
        if (event === 'error') this.onerror = handler
      }
      removeEventListener() {}
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }
  }

  const originalTextureLoader = THREE.TextureLoader.prototype.load
  THREE.TextureLoader.prototype.load = function (_url: string, onLoad?: (texture: THREE.Texture) => void) {
    const texture = new THREE.Texture()
    onLoad?.(texture)
    return texture
  }

  const previousWebSocket = (globalThis as any).WebSocket
  ;(globalThis as any).WebSocket = MockWebSocket as any

  const broker = createBrokerClient({ clientId: 'spec-world-seed' })
  const socket = mockSockets[0]
  assert.ok(socket, 'Expected a WebSocket instance to be created')

  const statusPromise = new Promise<{ worldId: string; mapId: string }>((resolve) => {
    broker.onWorldStatus((status) => resolve(status))
  })

  socket.open()
  socket.emitMessage(
    JSON.stringify({ type: 'world_status', world_id: 'alpha-sector', map_id: 'delta-map' })
  )

  const status = await statusPromise
  assert.equal(status.worldId, 'alpha-sector')
  assert.equal(status.mapId, 'delta-map')

  const sceneA = new THREE.Scene()
  const streamerA = createStreamer(sceneA, status)
  const focus = new THREE.Vector3(0, 0, 0)
  streamerA.update(focus, 0)
  const chunkA = sceneA.children.find((child) => (child as any).userData?.decorations) as THREE.Mesh
  assert(chunkA, 'Expected streamer to materialise a terrain chunk after initial update')
  const decorationsA = chunkA.userData.decorations as THREE.Object3D[]
  const matrixA = new THREE.Matrix4()
  if (decorationsA.length > 0) {
    const instancedA = decorationsA[0] as THREE.InstancedMesh
    instancedA.getMatrixAt(0, matrixA)
  }
  streamerA.dispose?.()

  const sceneB = new THREE.Scene()
  const streamerB = createStreamer(sceneB, status)
  streamerB.update(focus, 0)
  const chunkB = sceneB.children.find((child) => (child as any).userData?.decorations) as THREE.Mesh
  assert(chunkB, 'Expected second streamer to materialise a terrain chunk after initial update')
  const decorationsB = chunkB.userData.decorations as THREE.Object3D[]
  const matrixB = new THREE.Matrix4()
  if (decorationsB.length > 0) {
    const instancedB = decorationsB[0] as THREE.InstancedMesh
    instancedB.getMatrixAt(0, matrixB)
  }
  assert.equal(
    decorationsA.length,
    decorationsB.length,
    'Deterministic seeds should yield identical decoration counts'
  )
  if (decorationsA.length > 0) {
    assert.deepEqual(matrixA.toArray(), matrixB.toArray(), 'Chunk decorations should be identical for matching seeds')
  }

  const snapshot = getWorldSeedSnapshot()
  assert.equal(snapshot.worldId, 'alpha-sector')
  assert.equal(snapshot.mapId, 'delta-map')

  streamerB.dispose?.()
  broker.close()

  configureWorldSeeds()
  THREE.TextureLoader.prototype.load = originalTextureLoader
  if (!previousImage) {
    delete (globalThis as any).Image
  }
  if (!previousDocument) {
    delete (globalThis as any).document
  }
  ;(globalThis as any).WebSocket = previousWebSocket
  mockSockets.length = 0
}
