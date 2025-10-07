import * as THREE from 'three'
import { buildArrowhead } from '@/vehicles/arrowhead/build'
import { buildOctahedron } from '@/vehicles/octahedron/build'
import { buildPyramid } from '@/vehicles/pyramid/build'
import { buildIcosahedron } from '@/vehicles/icosahedron/build'
import { buildCube } from '@/vehicles/cube/build'
import { buildTransformer } from '@/vehicles/transformer/build'
import { createController } from '@/vehicles/shared/simpleController'

type VehicleKey = 'arrowhead' | 'octahedron' | 'pyramid' | 'icosahedron' | 'cube' | 'transformer'

export function createPlayer(initial: VehicleKey, scene: THREE.Scene) {
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

  //3.- Allow downstream consumers to swap vehicles while keeping the controller in sync.
  function setVehicle(key: VehicleKey) {
    if (currentMesh) group.remove(currentMesh)
    currentKey = key
    currentMesh = resolveVehicle(currentKey)
    group.add(currentMesh)
    controller.refreshVehicleClearance?.()
  }

  //4.- Provide a convenience cycle helper for sequential vehicle selection.
  function cycleVehicle() {
    const keys = Object.keys(builders) as VehicleKey[]
    const i = keys.indexOf(currentKey)
    setVehicle(keys[(i + 1) % keys.length])
  }

  return { group, controller, setVehicle, cycleVehicle }
}
