import * as THREE from 'three'
import {
  DEFAULT_PILOT_NAME,
  DEFAULT_VEHICLE_KEY,
  normalizePilotName,
  normalizeVehicleChoice,
  type VehicleKey
} from '@/lib/pilotProfile'
import type { BrokerOccupantDiff, BrokerOccupantSnapshot } from '@/lib/brokerClient'
import { buildArrowhead } from '@/vehicles/arrowhead/build'
import { buildCube } from '@/vehicles/cube/build'
import { buildIcosahedron } from '@/vehicles/icosahedron/build'
import { buildOctahedron } from '@/vehicles/octahedron/build'
import { buildPyramid } from '@/vehicles/pyramid/build'
import { buildTransformer } from '@/vehicles/transformer/build'

export type VehicleDiffPayload = {
  updated?: Array<Record<string, unknown>>
  removed?: string[]
}

type OccupantDiffPayload = BrokerOccupantDiff

type OccupantState = {
  playerName: string | null
  lifePct: number | null
}

type HealthBar = {
  root: THREE.Group
  fill: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  background: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
}

type RemoteVehicle = {
  group: THREE.Group
  mesh: THREE.Object3D
  label: THREE.Sprite | null
  profile: RemoteProfile
  labelSnapshot: { name: string; vehicleKey: VehicleKey }
  occupantName: string | null
  occupantLifePct: number | null
  healthBar: HealthBar | null
}

type RemoteProfile = {
  pilotName: string
  vehicleKey: VehicleKey
}

const VEHICLE_BUILDERS: Record<VehicleKey, () => THREE.Object3D> = {
  arrowhead: buildArrowhead,
  octahedron: buildOctahedron,
  pyramid: buildPyramid,
  icosahedron: buildIcosahedron,
  cube: buildCube,
  transformer: buildTransformer
}

export type RemoteVehicleTransform = {
  vehicleId: string
  position: { x: number; y: number; z: number }
  rotation: { pitch: number; yaw: number; roll: number }
}

export type RemotePlayersManager = {
  ingestDiff: (diff?: VehicleDiffPayload | null, occupants?: OccupantDiffPayload | null) => void
  dispose: () => void
  getVehicleGroup: (vehicleId: string) => THREE.Group | undefined
  activeVehicleIds: () => string[]
  snapshotTransforms: () => RemoteVehicleTransform[]
}

function parseNumber(value: unknown, fallback: number): number {
  //1.- Clamp to finite numeric values while falling back to the previous transform component when absent.
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function ensureOrientationRadians(orientation: Record<string, unknown> | undefined, current: THREE.Euler) {
  //1.- Convert aerospace degree fields into Euler radians, preserving existing rotation when components are omitted.
  const yaw = THREE.MathUtils.degToRad(parseNumber(orientation?.yaw_deg, THREE.MathUtils.radToDeg(current.y)))
  const pitch = THREE.MathUtils.degToRad(parseNumber(orientation?.pitch_deg, THREE.MathUtils.radToDeg(current.x)))
  const roll = THREE.MathUtils.degToRad(parseNumber(orientation?.roll_deg, THREE.MathUtils.radToDeg(current.z)))
  return { pitch, yaw, roll }
}

function disposeObject3D(object: THREE.Object3D) {
  //1.- Recursively free geometries, materials, and textures to avoid leaking GPU resources between updates.
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh) {
      mesh.geometry?.dispose?.()
      const material = mesh.material
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose?.())
      } else {
        material?.dispose?.()
      }
      return
    }
    const sprite = child as THREE.Sprite
    if (sprite.isSprite) {
      const spriteMaterial = sprite.material as THREE.SpriteMaterial | undefined
      spriteMaterial?.map?.dispose?.()
      spriteMaterial?.dispose?.()
    }
  })
}

function disposeGroup(group: THREE.Group) {
  //1.- Release geometries, textures, and nameplates so remote pilot despawns do not leak GPU memory across long sessions.
  disposeObject3D(group)
}

function instantiateVehicleMesh(vehicleKey: VehicleKey): THREE.Object3D {
  //1.- Resolve the registered vehicle builder and tag the result so debug overlays can trace the source chassis.
  const builder = VEHICLE_BUILDERS[vehicleKey] ?? VEHICLE_BUILDERS[DEFAULT_VEHICLE_KEY]
  const mesh = builder()
  mesh.name = `remote-vehicle-${vehicleKey}`
  return mesh
}

function formatGroupName(name: string, vehicleKey: VehicleKey) {
  //1.- Embed the effective display name and vehicle key in the group name to simplify scene graph inspection tools.
  return `remote-player:${name} (${vehicleKey})`
}

function createNameplate(profile: RemoteProfile): THREE.Sprite | null {
  //1.- Render a light-weight sprite label when the DOM is available so spectators can identify remote pilots.
  if (typeof document === 'undefined') {
    return null
  }
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent ?? '' : ''
  if (userAgent.toLowerCase().includes('jsdom')) {
    //2.- Skip label generation entirely during tests so jsdom's incomplete canvas API does not spam the console.
    return null
  }
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 40px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(profile.pilotName, canvas.width / 2, canvas.height / 2 - 20)
  ctx.font = '28px sans-serif'
  ctx.fillText(profile.vehicleKey, canvas.width / 2, canvas.height / 2 + 32)
  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false })
  const sprite = new THREE.Sprite(material)
  sprite.position.set(0, 6, 0)
  sprite.scale.set(6, 3, 1)
  return sprite
}

function disposeLabel(label: THREE.Sprite | null) {
  //1.- Remove existing nameplates and destroy their GPU resources before swapping in a refreshed texture.
  if (!label) {
    return
  }
  label.parent?.remove(label)
  const material = label.material as THREE.SpriteMaterial | undefined
  material?.map?.dispose?.()
  material?.dispose?.()
}

function extractProfile(state: Record<string, unknown>, fallback?: RemoteVehicle): RemoteProfile {
  //1.- Normalise the provided pilot name while falling back to the most recent cached identity.
  const container = state.profile as Record<string, unknown> | undefined
  const rawNameCandidates = [
    container?.name,
    container?.pilot_name,
    container?.pilotName,
    state.pilot_name,
    state.pilotName
  ]
  const candidateName = rawNameCandidates.find((value): value is string => typeof value === 'string')
  const normalisedName = normalizePilotName(candidateName)
  const pilotName = normalisedName || fallback?.profile.pilotName || DEFAULT_PILOT_NAME

  //2.- Coerce the vehicle key to a known builder, preserving the previous chassis when metadata is absent.
  const rawVehicleCandidates = [
    container?.vehicle,
    container?.vehicle_key,
    container?.vehicleKey,
    state.vehicle,
    state.vehicle_key,
    state.vehicleKey,
    state.vehicle_type,
    state.vehicleType
  ]
  const candidateVehicle = rawVehicleCandidates.find((value): value is string => typeof value === 'string')
  const fallbackVehicle = fallback?.profile.vehicleKey ?? DEFAULT_VEHICLE_KEY
  const vehicleKey = normalizeVehicleChoice(candidateVehicle ?? fallbackVehicle)

  return { pilotName, vehicleKey }
}

export function createRemotePlayerManager(scene: THREE.Scene): RemotePlayersManager {
  //1.- Anchor all remote pilot meshes under a dedicated group for simpler lifecycle management.
  const root = new THREE.Group()
  root.name = 'remote-players-root'
  scene.add(root)

  const registry = new Map<string, RemoteVehicle>()
  const occupantRegistry = new Map<string, OccupantState>()

  function createHealthBar(): HealthBar {
    //1.- Build a simple quad-based HUD that floats above the vehicle to visualise occupant health.
    const root = new THREE.Group()
    root.name = 'remote-health-bar'
    root.position.set(0, 5.5, 0)
    root.visible = false

    const backgroundGeometry = new THREE.PlaneGeometry(4.4, 0.4)
    const backgroundMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0.65, transparent: true, depthTest: false })
    const background = new THREE.Mesh(backgroundGeometry, backgroundMaterial)
    background.name = 'remote-health-bar-bg'
    background.renderOrder = 10
    root.add(background)

    const fillGeometry = new THREE.PlaneGeometry(4, 0.24)
    const fillMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00, depthTest: false })
    const fill = new THREE.Mesh(fillGeometry, fillMaterial)
    fill.name = 'remote-health-bar-fill'
    fill.position.set(0, 0, 0.01)
    fill.renderOrder = 11
    root.add(fill)

    return { root, fill, background }
  }

  function disposeHealthBar(bar: HealthBar | null) {
    //1.- Release the quad geometries and materials attached to the occupant health indicator.
    if (!bar) {
      return
    }
    bar.root.parent?.remove(bar.root)
    bar.fill.geometry.dispose()
    bar.fill.material.dispose()
    bar.background.geometry.dispose()
    bar.background.material.dispose()
  }

  function refreshDisplayMetadata(vessel: RemoteVehicle) {
    //1.- Resolve the preferred display name, prioritising the occupant overlay when present.
    const displayName = vessel.occupantName ?? vessel.profile.pilotName
    const displayVehicleKey = vessel.profile.vehicleKey
    const previous = vessel.labelSnapshot
    const requiresRefresh =
      !previous || previous.name !== displayName || previous.vehicleKey !== displayVehicleKey

    if (requiresRefresh) {
      disposeLabel(vessel.label)
      const label = createNameplate({ pilotName: displayName, vehicleKey: displayVehicleKey })
      if (label) {
        vessel.group.add(label)
      }
      vessel.label = label
      vessel.labelSnapshot = { name: displayName, vehicleKey: displayVehicleKey }
    }

    //2.- Surface the latest metadata on the group for diagnostics and tests.
    vessel.group.name = formatGroupName(displayName, displayVehicleKey)
    vessel.group.userData.remoteProfile = vessel.profile
    vessel.group.userData.remoteOccupant = vessel.occupantName
      ? { playerName: vessel.occupantName, lifePct: vessel.occupantLifePct }
      : null
  }

  function updateHealthVisual(vessel: RemoteVehicle) {
    //1.- Hide the indicator entirely when no occupant health is provided.
    const bar = vessel.healthBar
    if (!bar) {
      return
    }
    const value = vessel.occupantLifePct
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      bar.root.visible = false
      return
    }
    const clamped = THREE.MathUtils.clamp(value, 0, 1)
    bar.root.visible = true
    bar.fill.scale.x = clamped
    bar.fill.position.x = (clamped - 1) * 2
    const material = bar.fill.material
    material.color.setRGB(1 - clamped, clamped, 0)
  }

  function createRemoteVehicle(profile: RemoteProfile): RemoteVehicle {
    //1.- Materialise the remote pilot group with a vehicle mesh, optional HUD nameplate, and health bar.
    const group = new THREE.Group()
    const mesh = instantiateVehicleMesh(profile.vehicleKey)
    group.add(mesh)

    const label = createNameplate(profile)
    if (label) {
      group.add(label)
    }

    const healthBar = createHealthBar()
    group.add(healthBar.root)

    const snapshot = { name: profile.pilotName, vehicleKey: profile.vehicleKey }
    group.name = formatGroupName(snapshot.name, snapshot.vehicleKey)
    group.userData.remoteProfile = profile
    group.userData.remoteOccupant = null
    root.add(group)

    return {
      group,
      mesh,
      label,
      profile,
      labelSnapshot: snapshot,
      occupantName: null,
      occupantLifePct: null,
      healthBar
    }
  }

  function updateRemoteVehicle(vessel: RemoteVehicle, profile: RemoteProfile) {
    //1.- Swap the chassis when the authoritative vehicle changes.
    const previousVehicleKey = vessel.profile.vehicleKey
    if (profile.vehicleKey !== previousVehicleKey) {
      vessel.group.remove(vessel.mesh)
      disposeObject3D(vessel.mesh)
      const replacement = instantiateVehicleMesh(profile.vehicleKey)
      vessel.group.add(replacement)
      vessel.mesh = replacement
    }

    vessel.profile = profile
    refreshDisplayMetadata(vessel)
  }

  function applyOccupantToVehicle(vehicleId: string) {
    //1.- Synchronise the cached occupant metadata with the instantiated remote vehicle.
    const vessel = registry.get(vehicleId)
    if (!vessel) {
      return
    }
    const occupant = occupantRegistry.get(vehicleId)
    vessel.occupantName = occupant?.playerName ?? null
    vessel.occupantLifePct = occupant?.lifePct ?? null
    refreshDisplayMetadata(vessel)
    updateHealthVisual(vessel)
  }

  function upsertVehicle(state: Record<string, unknown>) {
    //1.- Skip malformed payloads that fail to identify the authoritative vehicle id.
    const vehicleId = typeof state.vehicle_id === 'string' && state.vehicle_id.trim() !== '' ? state.vehicle_id : null
    if (!vehicleId) {
      return
    }

    const existing = registry.get(vehicleId)
    const profile = extractProfile(state, existing)
    const vessel = existing ?? createRemoteVehicle(profile)
    if (!existing) {
      registry.set(vehicleId, vessel)
    }

    if (existing) {
      updateRemoteVehicle(vessel, profile)
    }

    if (!existing) {
      vessel.group.position.set(0, 0, 0)
      vessel.group.rotation.set(0, 0, 0, 'YXZ')
    }

    const position = state.position as Record<string, unknown> | undefined
    const nextPosition = vessel.group.position
    const x = parseNumber(position?.x, nextPosition.x)
    const y = parseNumber(position?.y, nextPosition.y)
    const z = parseNumber(position?.z, nextPosition.z)
    vessel.group.position.set(x, y, z)

    const orientation = state.orientation as Record<string, unknown> | undefined
    const { pitch, yaw, roll } = ensureOrientationRadians(orientation, vessel.group.rotation)
    vessel.group.rotation.set(pitch, yaw, roll, 'YXZ')

    applyOccupantToVehicle(vehicleId)
  }

  function removeVehicle(vehicleId: string) {
    //1.- Remove stale remote pilots from the scene graph and dispose of their GPU resources.
    const entry = registry.get(vehicleId)
    if (!entry) {
      occupantRegistry.delete(vehicleId)
      return
    }
    disposeHealthBar(entry.healthBar)
    root.remove(entry.group)
    disposeGroup(entry.group)
    registry.delete(vehicleId)
    occupantRegistry.delete(vehicleId)
  }

  function parseOccupantEntry(entry: BrokerOccupantSnapshot): { id: string; state: OccupantState } | null {
    //1.- Validate the vehicle identifier and capture the associated occupant payload.
    const vehicleId = typeof entry.vehicle_id === 'string' ? entry.vehicle_id.trim() : ''
    if (!vehicleId) {
      return null
    }
    const rawName =
      typeof entry.player_name === 'string'
        ? entry.player_name.trim()
        : typeof (entry as Record<string, unknown>).playerName === 'string'
          ? String((entry as Record<string, unknown>).playerName).trim()
          : ''
    const playerName = rawName !== '' ? rawName : null
    const lifePct =
      typeof entry.life_pct === 'number' && Number.isFinite(entry.life_pct)
        ? THREE.MathUtils.clamp(entry.life_pct, 0, 1)
        : typeof (entry as Record<string, unknown>).lifePct === 'number' && Number.isFinite((entry as Record<string, unknown>).lifePct)
          ? THREE.MathUtils.clamp((entry as Record<string, unknown>).lifePct as number, 0, 1)
          : null
    return { id: vehicleId, state: { playerName, lifePct } }
  }

  function ingestOccupants(diff?: OccupantDiffPayload | null) {
    //1.- Withdraw occupant overlays that were explicitly removed in the diff.
    const removed = diff?.removed
    if (Array.isArray(removed)) {
      for (const id of removed) {
        if (typeof id !== 'string') {
          continue
        }
        const trimmed = id.trim()
        if (!trimmed) {
          continue
        }
        occupantRegistry.delete(trimmed)
        const vessel = registry.get(trimmed)
        if (vessel) {
          vessel.occupantName = null
          vessel.occupantLifePct = null
          refreshDisplayMetadata(vessel)
          updateHealthVisual(vessel)
        }
      }
    }

    const updated = diff?.updated
    if (Array.isArray(updated)) {
      for (const entry of updated) {
        if (!entry) {
          continue
        }
        const parsed = parseOccupantEntry(entry)
        if (!parsed) {
          continue
        }
        const previous = occupantRegistry.get(parsed.id) ?? { playerName: null, lifePct: null }
        const next: OccupantState = {
          playerName: parsed.state.playerName ?? previous.playerName,
          lifePct: parsed.state.lifePct ?? previous.lifePct
        }
        occupantRegistry.set(parsed.id, next)
        applyOccupantToVehicle(parsed.id)
      }
    }
  }

  function ingestDiff(diff?: VehicleDiffPayload | null, occupants?: OccupantDiffPayload | null) {
    //1.- Apply authoritative removals before updates so respawns do not inherit stale transforms.
    const removed = diff?.removed
    if (Array.isArray(removed)) {
      for (const id of removed) {
        if (typeof id === 'string' && id.trim() !== '') {
          removeVehicle(id.trim())
        }
      }
    }

    const updated = diff?.updated
    if (Array.isArray(updated)) {
      //2.- Integrate each vehicle snapshot into the registry, creating meshes on demand.
      for (const state of updated) {
        if (state && typeof state === 'object') {
          upsertVehicle(state)
        }
      }
    }

    ingestOccupants(occupants)
  }

  function dispose() {
    //1.- Detach the root container and drain all registered remote pilots.
    for (const entry of registry.values()) {
      disposeHealthBar(entry.healthBar)
      root.remove(entry.group)
      disposeGroup(entry.group)
    }
    registry.clear()
    occupantRegistry.clear()
    root.parent?.remove(root)
  }

  function getVehicleGroup(vehicleId: string) {
    //1.- Expose internal groups for diagnostics and tests without leaking mutation access to callers.
    return registry.get(vehicleId)?.group
  }

  function activeVehicleIds() {
    //1.- Provide a deterministic ordering for assertions by sorting the registry keys alphabetically.
    return Array.from(registry.keys()).sort()
  }

  function snapshotTransforms(): RemoteVehicleTransform[] {
    //1.- Clone positional and rotational data so callers cannot mutate the live Three.js vectors.
    const entries: RemoteVehicleTransform[] = []
    for (const [vehicleId, vessel] of registry.entries()) {
      const { position, rotation } = vessel.group
      entries.push({
        vehicleId,
        position: { x: position.x, y: position.y, z: position.z },
        rotation: { pitch: rotation.x, yaw: rotation.y, roll: rotation.z }
      })
    }
    //2.- Return a fresh array every call to preserve the read-only contract described by the HUD minimap.
    return entries
  }

  return { ingestDiff, dispose, getVehicleGroup, activeVehicleIds, snapshotTransforms }
}
