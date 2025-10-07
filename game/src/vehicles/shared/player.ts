import * as THREE from 'three'
import { buildArrowhead } from '@/vehicles/arrowhead/build'
import { buildOctahedron } from '@/vehicles/octahedron/build'
import { buildPyramid } from '@/vehicles/pyramid/build'
import { buildIcosahedron } from '@/vehicles/icosahedron/build'
import { buildCube } from '@/vehicles/cube/build'
import { buildTransformer } from '@/vehicles/transformer/build'
import { buildTank } from '@/vehicles/tank/build'
import { createController } from '@/vehicles/shared/simpleController'
import { createNameplate } from '@/ui/nameplate'

type VehicleKey =
  | 'arrowhead'
  | 'octahedron'
  | 'pyramid'
  | 'icosahedron'
  | 'cube'
  | 'transformer'
  | 'tank'

type InputLike = { pressed: (code: string) => boolean }

type VehicleHooks = {
  update?: (dt: number, input: InputLike) => void
  dispose?: () => void
}

export function createPlayer(initial: VehicleKey, scene: THREE.Scene, pilotName?: string) {
  //1.- Instantiate the player anchor group and populate the builder registry keyed by vehicle ids.
  const group = new THREE.Group()
  scene.add(group)
  const builders: Record<VehicleKey, () => THREE.Object3D> = {
    arrowhead: buildArrowhead,
    octahedron: buildOctahedron,
    pyramid: buildPyramid,
    icosahedron: buildIcosahedron,
    cube: buildCube,
    transformer: buildTransformer,
    tank: buildTank
  }

  const resolveVehicle = (key: VehicleKey) => {
    const builder = builders[key]
    if (!builder) {
      throw new Error(`Vehicle builder missing for key: ${key}`)
    }
    return builder()
  }

  //2.- Materialise the initial mesh and bootstrap the controller for input-driven updates.
  let currentKey: VehicleKey = initial
  let currentMesh = resolveVehicle(currentKey)
  group.add(currentMesh)
  const controller = createController(group, scene)
  controller.refreshVehicleClearance?.()

  let activeHooks: VehicleHooks | null = null

  function extractHooks(mesh: THREE.Object3D | null): VehicleHooks | null {
    //1.- Safely read the optional vehicle hook bag while tolerating meshes without custom behaviour.
    if (!mesh) {
      return null
    }
    const hooks = mesh.userData?.vehicleHooks
    if (hooks && typeof hooks === 'object') {
      return hooks as VehicleHooks
    }
    return null
  }

  activeHooks = extractHooks(currentMesh)

  let nameplate: THREE.Sprite | null = null

  function disposeNameplate() {
    //1.- Remove the current nameplate sprite and free its GPU resources before recreating it.
    if (!nameplate) {
      return
    }
    nameplate.parent?.remove(nameplate)
    const material = nameplate.material as THREE.SpriteMaterial | undefined
    material?.map?.dispose?.()
    material?.dispose?.()
    nameplate = null
  }

  function refreshNameplate() {
    //1.- Skip nameplate creation entirely when no pilot name is provided or the DOM is unavailable.
    if (!pilotName || typeof document === 'undefined') {
      disposeNameplate()
      return
    }
    disposeNameplate()
    const label = createNameplate({ pilotName, vehicleKey: currentKey })
    if (label) {
      group.add(label)
      nameplate = label
      return
    }
    //2.- Fall back to an invisible sprite so tests without a canvas implementation retain the metadata contract.
    const placeholderMaterial = new THREE.SpriteMaterial({ opacity: 0, transparent: true, depthTest: false })
    const placeholder = new THREE.Sprite(placeholderMaterial)
    placeholder.userData.nameplate = { pilotName, vehicleKey: currentKey }
    placeholder.visible = false
    group.add(placeholder)
    nameplate = placeholder
  }

  //2.- Prime the HUD label so the local pilot mirrors remote displays immediately after spawning.
  refreshNameplate()

  //3.- Allow downstream consumers to swap vehicles while keeping the controller in sync.
  function setVehicle(key: VehicleKey) {
    activeHooks?.dispose?.()
    if (currentMesh) group.remove(currentMesh)
    currentKey = key
    currentMesh = resolveVehicle(currentKey)
    group.add(currentMesh)
    controller.refreshVehicleClearance?.()
    refreshNameplate()
    activeHooks = extractHooks(currentMesh)
  }

  //4.- Provide a convenience cycle helper for sequential vehicle selection.
  function cycleVehicle() {
    const keys = Object.keys(builders) as VehicleKey[]
    const i = keys.indexOf(currentKey)
    setVehicle(keys[(i + 1) % keys.length])
  }

  function updateVehicle(dt: number, input: InputLike) {
    //1.- Allow vehicle-specific hooks to react to frame input alongside the shared flight controller.
    activeHooks?.update?.(dt, input)
  }

  return { group, controller, setVehicle, cycleVehicle, updateVehicle }
}
