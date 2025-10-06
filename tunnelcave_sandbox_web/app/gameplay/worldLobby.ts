export interface WorldVector3 {
  //1.- Reusable vector tuple describing a point or velocity in the shared world.
  x: number
  y: number
  z: number
}

export interface WorldPeerSnapshot {
  //1.- Session identifier uniquely tagging the remote pilot.
  sessionId: string
  //2.- Callsign supplied during lobby join to label the craft in overlays.
  name: string
  //3.- Selected vehicle identifier so UI can communicate the loadout.
  vehicleId: string
  //4.- Most recently reported world position in metres.
  position: WorldVector3
  //5.- Latest velocity sample derived from the player's simulation frame.
  velocity: WorldVector3
}

interface LobbyPeerRecord extends WorldPeerSnapshot {
  //1.- Timestamp in milliseconds since epoch when the peer last updated their presence.
  updatedAt: number
}

type LobbyMessage =
  | {
      //1.- Join broadcasts share identity information and the current spawn position.
      type: 'announce'
      worldId: string
      sessionId: string
      name: string
      vehicleId: string
      position: WorldVector3
      velocity: WorldVector3
      timestamp: number
    }
  | {
      //1.- State updates stream motion so remote clients can animate the craft smoothly.
      type: 'state'
      worldId: string
      sessionId: string
      position: WorldVector3
      velocity: WorldVector3
      timestamp: number
    }
  | {
      //1.- Leave notifications prune the peer immediately without waiting for stale detection.
      type: 'leave'
      worldId: string
      sessionId: string
      timestamp: number
    }

interface LobbyChannel {
  //1.- Broadcast the given message to every connected participant listening on the same channel.
  postMessage: (message: LobbyMessage) => void
  //2.- Attach a listener reacting to inbound messages.
  addEventListener: (type: 'message', listener: (event: { data: LobbyMessage }) => void) => void
  //3.- Detach the given listener when the lobby shuts down.
  removeEventListener: (type: 'message', listener: (event: { data: LobbyMessage }) => void) => void
  //4.- Close the underlying channel so the browser releases associated resources.
  close: () => void
}

export interface WorldLobbyOptions {
  //1.- Override the BroadcastChannel factory for testing or non-browser environments.
  createChannel?: (channelName: string) => LobbyChannel | null
  //2.- Inject a deterministic clock so tests can control timestamps precisely.
  now?: () => number
  //3.- Customise the heartbeat cadence that refreshes join announcements.
  heartbeatIntervalMs?: number
  //4.- Configure how long a peer can stay silent before being considered disconnected.
  staleThresholdMs?: number
}

export interface CreateWorldLobbyParams {
  //1.- Identifier for the shared world that every participant must target.
  worldId: string
  //2.- Locally generated session identifier for the active player.
  sessionId: string
  //3.- Pilot callsign captured during the lobby flow.
  name: string
  //4.- Selected vehicle identifier powering cosmetics and HUD messaging.
  vehicleId: string
  //5.- Initial spawn position so peers render the craft immediately after joining.
  spawn: WorldVector3
}

export interface WorldLobby {
  //1.- Subscribe to presence changes and receive the latest peer snapshot collection.
  subscribe: (listener: (peers: WorldPeerSnapshot[]) => void) => () => void
  //2.- Publish the latest simulated position and velocity for the local player.
  updatePresence: (state: { position: WorldVector3; velocity: WorldVector3 }) => void
  //3.- Release resources, emit a leave announcement, and stop heartbeats.
  dispose: () => void
}

const CHANNEL_PREFIX = 'driftpursuit-world:'
export const SHARED_WORLD_ID = 'tunnelcave:shared-world'
export const SHARED_WORLD_SEED = 0x4c1d2ab3

function cloneVector(source: WorldVector3): WorldVector3 {
  //1.- Create a shallow copy so consumers cannot mutate the internal state map by accident.
  return { x: source.x, y: source.y, z: source.z }
}

function defaultCreateChannel(channelName: string): LobbyChannel | null {
  //1.- Guard against server-side rendering where the BroadcastChannel API is unavailable.
  if (typeof window === 'undefined') {
    return null
  }
  const BroadcastConstructor: typeof BroadcastChannel | undefined = (window as typeof window & {
    BroadcastChannel?: typeof BroadcastChannel
  }).BroadcastChannel
  if (typeof BroadcastConstructor !== 'function') {
    return null
  }
  const channel = new BroadcastConstructor(channelName)
  const listenerWrappers = new Map<
    (event: { data: LobbyMessage }) => void,
    (event: Event) => void
  >()
  return {
    postMessage: (message) => {
      channel.postMessage(message)
    },
    addEventListener: (type, listener) => {
      const wrapper = (event: Event) => {
        listener({ data: (event as MessageEvent<LobbyMessage>).data })
      }
      listenerWrappers.set(listener, wrapper)
      channel.addEventListener(type, wrapper as EventListener)
    },
    removeEventListener: (type, listener) => {
      const wrapper = listenerWrappers.get(listener)
      if (wrapper) {
        channel.removeEventListener(type, wrapper as EventListener)
        listenerWrappers.delete(listener)
      }
    },
    close: () => {
      channel.close()
      listenerWrappers.clear()
    },
  }
}

export function createWorldLobby(
  params: CreateWorldLobbyParams,
  options: WorldLobbyOptions = {},
): WorldLobby {
  //1.- Resolve helpers and configuration defaults so behaviour remains stable across environments.
  const createChannel = options.createChannel ?? defaultCreateChannel
  const now = options.now ?? (() => Date.now())
  const heartbeatInterval = options.heartbeatIntervalMs ?? 2000
  const staleThreshold = options.staleThresholdMs ?? heartbeatInterval * 3
  const channelName = `${CHANNEL_PREFIX}${params.worldId}`
  const channel = createChannel(channelName)
  const peers = new Map<string, LobbyPeerRecord>()
  const listeners = new Set<(peers: WorldPeerSnapshot[]) => void>()
  let lastPresence: { position: WorldVector3; velocity: WorldVector3 } = {
    position: cloneVector(params.spawn),
    velocity: { x: 0, y: 0, z: 0 },
  }

  const emit = () => {
    //1.- Share a cloned snapshot with each subscriber so React state updates stay pure.
    const snapshot = Array.from(peers.values()).map((peer) => ({
      sessionId: peer.sessionId,
      name: peer.name,
      vehicleId: peer.vehicleId,
      position: cloneVector(peer.position),
      velocity: cloneVector(peer.velocity),
    }))
    listeners.forEach((listener) => listener(snapshot))
  }

  const upsertPeer = (payload: LobbyPeerRecord) => {
    //1.- Merge the latest data for the given peer and re-emit subscribers with the refreshed state.
    peers.set(payload.sessionId, payload)
    emit()
  }

  const removePeer = (sessionId: string) => {
    //1.- Drop the peer from the roster and notify subscribers when the entry exists.
    if (peers.delete(sessionId)) {
      emit()
    }
  }

  const pruneStale = () => {
    //1.- Remove peers whose heartbeat has expired to keep the roster accurate when tabs crash.
    const cutoff = now() - staleThreshold
    let changed = false
    peers.forEach((peer, sessionId) => {
      if (peer.updatedAt < cutoff) {
        peers.delete(sessionId)
        changed = true
      }
    })
    if (changed) {
      emit()
    }
  }

  const handleMessage = (event: { data: LobbyMessage }) => {
    const message = event.data
    if (message.worldId !== params.worldId) {
      return
    }
    if (message.sessionId === params.sessionId) {
      return
    }
    if (message.type === 'leave') {
      removePeer(message.sessionId)
      return
    }
    if (message.type === 'announce') {
      const wasKnown = peers.has(message.sessionId)
      const record: LobbyPeerRecord = {
        sessionId: message.sessionId,
        name: message.name,
        vehicleId: message.vehicleId,
        position: cloneVector(message.position),
        velocity: cloneVector(message.velocity),
        updatedAt: message.timestamp,
      }
      upsertPeer(record)
      if (!wasKnown) {
        //2.- Reply with our own announce so late joiners populate their roster quickly without infinite loops.
        sendAnnounce()
      }
      return
    }
    if (message.type === 'state') {
      const existing = peers.get(message.sessionId)
      const record: LobbyPeerRecord = {
        sessionId: message.sessionId,
        name: existing?.name ?? 'Wingmate',
        vehicleId: existing?.vehicleId ?? 'arrowhead',
        position: cloneVector(message.position),
        velocity: cloneVector(message.velocity),
        updatedAt: message.timestamp,
      }
      upsertPeer(record)
    }
  }

  const send = (message: LobbyMessage) => {
    //1.- Broadcast messages only when a channel is available which is not the case on the server.
    if (!channel) {
      return
    }
    channel.postMessage(message)
  }

  const sendAnnounce = () => {
    //1.- Publish the latest identity and presence so peers can spawn our craft instantly.
    send({
      type: 'announce',
      worldId: params.worldId,
      sessionId: params.sessionId,
      name: params.name,
      vehicleId: params.vehicleId,
      position: cloneVector(lastPresence.position),
      velocity: cloneVector(lastPresence.velocity),
      timestamp: now(),
    })
  }

  const sendState = () => {
    //1.- Mirror the current transform into the network so everyone sees the updated motion.
    send({
      type: 'state',
      worldId: params.worldId,
      sessionId: params.sessionId,
      position: cloneVector(lastPresence.position),
      velocity: cloneVector(lastPresence.velocity),
      timestamp: now(),
    })
  }

  if (channel) {
    channel.addEventListener('message', handleMessage)
  }

  const heartbeat: ReturnType<typeof setInterval> | null = channel
    ? setInterval(() => {
        //1.- Periodically advertise our presence and clean up any stale peers.
        sendAnnounce()
        pruneStale()
      }, heartbeatInterval)
    : null

  //1.- Emit an initial announce so existing peers can render our craft immediately.
  sendAnnounce()

  return {
    subscribe: (listener) => {
      //1.- Register the listener and synchronously deliver the current roster.
      listeners.add(listener)
      listener(Array.from(peers.values()).map((peer) => ({
        sessionId: peer.sessionId,
        name: peer.name,
        vehicleId: peer.vehicleId,
        position: cloneVector(peer.position),
        velocity: cloneVector(peer.velocity),
      })))
      return () => {
        listeners.delete(listener)
      }
    },
    updatePresence: (state) => {
      //1.- Snapshot the latest transform, broadcast it, and refresh the heartbeat timer.
      lastPresence = {
        position: cloneVector(state.position),
        velocity: cloneVector(state.velocity),
      }
      sendState()
    },
    dispose: () => {
      //1.- Stop heartbeats, remove listeners, and inform peers that we have disconnected.
      if (heartbeat !== null) {
        clearInterval(heartbeat)
      }
      if (channel) {
        channel.removeEventListener('message', handleMessage)
        send({
          type: 'leave',
          worldId: params.worldId,
          sessionId: params.sessionId,
          timestamp: now(),
        })
        channel.close()
      }
      listeners.clear()
      peers.clear()
    },
  }
}
