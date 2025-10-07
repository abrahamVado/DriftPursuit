import * as THREE from 'three'
import {
  DEFAULT_PILOT_NAME,
  DEFAULT_VEHICLE_KEY,
  normalizePilotName,
  normalizeVehicleChoice,
  type VehicleKey
} from '@/lib/pilotProfile'
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

type RemoteVehicle = {
  group: THREE.Group
  mesh: THREE.Object3D
  label: THREE.Sprite | null
  vehicleKey: VehicleKey
  pilotName: string
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

export type RemotePlayersManager = {
  ingestDiff: (diff?: VehicleDiffPayload | null) => void
  dispose: () => void
  getVehicleGroup: (vehicleId: string) => THREE.Group | undefined
  activeVehicleIds: () => string[]
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

function formatGroupName(profile: RemoteProfile) {
  //1.- Embed the pilot name and vehicle key in the group name to simplify scene graph inspection tools.
  return `remote-player:${profile.pilotName} (${profile.vehicleKey})`
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
  const pilotName = normalisedName || fallback?.pilotName || DEFAULT_PILOT_NAME

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
  const fallbackVehicle = fallback?.vehicleKey ?? DEFAULT_VEHICLE_KEY
  const vehicleKey = normalizeVehicleChoice(candidateVehicle ?? fallbackVehicle)

  return { pilotName, vehicleKey }
}

export function createRemotePlayerManager(scene: THREE.Scene): RemotePlayersManager {
  //1.- Anchor all remote pilot meshes under a dedicated group for simpler lifecycle management.
  const root = new THREE.Group()
  root.name = 'remote-players-root'
  scene.add(root)

  const registry = new Map<string, RemoteVehicle>()

  function createRemoteVehicle(profile: RemoteProfile): RemoteVehicle {
    //1.- Materialise the remote pilot group with a vehicle mesh and optional HUD nameplate.
    const group = new THREE.Group()
    const mesh = instantiateVehicleMesh(profile.vehicleKey)
    group.add(mesh)
    const label = createNameplate(profile)
    if (label) {
      group.add(label)
    }
    group.name = formatGroupName(profile)
    group.userData.remoteProfile = profile
    root.add(group)
    return { group, mesh, label, vehicleKey: profile.vehicleKey, pilotName: profile.pilotName }
  }

  function updateRemoteVehicle(vessel: RemoteVehicle, profile: RemoteProfile) {
    //1.- Swap the chassis when the authoritative vehicle changes.
    const previousVehicleKey = vessel.vehicleKey
    if (profile.vehicleKey !== previousVehicleKey) {
      vessel.group.remove(vessel.mesh)
      disposeObject3D(vessel.mesh)
      const replacement = instantiateVehicleMesh(profile.vehicleKey)
      vessel.group.add(replacement)
      vessel.mesh = replacement
      vessel.vehicleKey = profile.vehicleKey
    }

    //2.- Refresh the floating nameplate whenever the pilot identity or chassis changes.
    if (profile.pilotName !== vessel.pilotName || profile.vehicleKey !== previousVehicleKey) {
      disposeLabel(vessel.label)
      const label = createNameplate(profile)
      if (label) {
        vessel.group.add(label)
      }
      vessel.label = label
    }

    //3.- Persist the latest metadata on the group for external diagnostics.
    vessel.group.name = formatGroupName(profile)
    vessel.group.userData.remoteProfile = profile
    vessel.pilotName = profile.pilotName
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
  }

  function removeVehicle(vehicleId: string) {
    //1.- Remove stale remote pilots from the scene graph and dispose of their GPU resources.
    const entry = registry.get(vehicleId)
    if (!entry) {
      return
    }
    root.remove(entry.group)
    disposeGroup(entry.group)
    registry.delete(vehicleId)
  }

  function ingestDiff(diff?: VehicleDiffPayload | null) {
    //1.- Apply authoritative removals before updates so respawns do not inherit stale transforms.
    const removed = diff?.removed
    if (Array.isArray(removed)) {
      for (const id of removed) {
        if (typeof id === 'string' && id.trim() !== '') {
          removeVehicle(id)
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
  }

  function dispose() {
    //1.- Detach the root container and drain all registered remote pilots.
    for (const entry of registry.values()) {
      root.remove(entry.group)
      disposeGroup(entry.group)
    }
    registry.clear()
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

  return { ingestDiff, dispose, getVehicleGroup, activeVehicleIds }
}
