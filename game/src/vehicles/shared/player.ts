import * as THREE from 'three'
import { buildArrowhead } from '@/vehicles/arrowhead/build'
import { buildOctahedron } from '@/vehicles/octahedron/build'
import { buildPyramid } from '@/vehicles/pyramid/build'
import { buildIcosahedron } from '@/vehicles/icosahedron/build'
import { buildCube } from '@/vehicles/cube/build'
import { buildTransformer } from '@/vehicles/transformer/build'
import { createController } from '@/vehicles/shared/simpleController'
import { createNameplate } from '@/ui/nameplate'

type VehicleKey = 'arrowhead' | 'octahedron' | 'pyramid' | 'icosahedron' | 'cube' | 'transformer'

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
    transformer: buildTransformer
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
    }
  }

  //2.- Prime the HUD label so the local pilot mirrors remote displays immediately after spawning.
  refreshNameplate()

  //3.- Allow downstream consumers to swap vehicles while keeping the controller in sync.
  function setVehicle(key: VehicleKey) {
    if (currentMesh) group.remove(currentMesh)
    currentKey = key
    currentMesh = resolveVehicle(currentKey)
    group.add(currentMesh)
    controller.refreshVehicleClearance?.()
    refreshNameplate()
  }

  //4.- Provide a convenience cycle helper for sequential vehicle selection.
  function cycleVehicle() {
    const keys = Object.keys(builders) as VehicleKey[]
    const i = keys.indexOf(currentKey)
    setVehicle(keys[(i + 1) % keys.length])
  }

  return { group, controller, setVehicle, cycleVehicle }
}
