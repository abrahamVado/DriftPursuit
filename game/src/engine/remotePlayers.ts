import * as THREE from 'three'

export type VehicleDiffPayload = {
  updated?: Array<Record<string, unknown>>
  removed?: string[]
}

type RemoteVehicle = {
  group: THREE.Group
  mesh: THREE.Mesh
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

function disposeGroup(group: THREE.Group) {
  //1.- Release geometries and materials so remote pilot despawns do not leak GPU memory across long sessions.
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh) {
      mesh.geometry?.dispose?.()
      const material = mesh.material
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose?.())
      } else {
        material?.dispose?.()
      }
    }
  })
}

export function createRemotePlayerManager(scene: THREE.Scene): RemotePlayersManager {
  //1.- Anchor all remote pilot meshes under a dedicated group for simpler lifecycle management.
  const root = new THREE.Group()
  root.name = 'remote-players-root'
  scene.add(root)

  const registry = new Map<string, RemoteVehicle>()

  function buildMesh(): RemoteVehicle {
    //1.- Construct a stylised silhouette that keeps remote pilots visually distinct from the local craft.
    const group = new THREE.Group()
    const geometry = new THREE.ConeGeometry(1.5, 6, 6)
    geometry.rotateX(Math.PI / 2)
    const material = new THREE.MeshStandardMaterial({ color: 0x4fc3f7, metalness: 0.1, roughness: 0.6 })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    root.add(group)
    return { group, mesh }
  }

  function upsertVehicle(state: Record<string, unknown>) {
    //1.- Skip malformed payloads that fail to identify the authoritative vehicle id.
    const vehicleId = typeof state.vehicle_id === 'string' && state.vehicle_id.trim() !== '' ? state.vehicle_id : null
    if (!vehicleId) {
      return
    }

    const existing = registry.get(vehicleId)
    const vessel = existing ?? buildMesh()
    if (!existing) {
      registry.set(vehicleId, vessel)
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
