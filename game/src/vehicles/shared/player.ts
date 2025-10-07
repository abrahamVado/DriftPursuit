import * as THREE from 'three'
import { buildArrowhead } from '@/vehicles/arrowhead/build'
import { buildOctahedron } from '@/vehicles/octahedron/build'
import { buildPyramid } from '@/vehicles/pyramid/build'
import { buildIcosahedron } from '@/vehicles/icosahedron/build'
import { buildCube } from '@/vehicles/cube/build'
import { createController } from '@/vehicles/shared/simpleController'

export function createPlayer(initial:'arrowhead'|'octahedron'|'pyramid'|'icosahedron'|'cube', scene: THREE.Scene){
  const group = new THREE.Group()
  scene.add(group)

  const builders = {
    arrowhead: buildArrowhead,
    octahedron: buildOctahedron,
    pyramid: buildPyramid,
    icosahedron: buildIcosahedron,
    cube: buildCube
  }

  let currentKey = initial
  let currentMesh = builders[currentKey]()
  group.add(currentMesh)

  const controller = createController(group, scene)

  function setVehicle(key: keyof typeof builders){
    if (currentMesh) group.remove(currentMesh)
    currentKey = key
    currentMesh = builders[currentKey]()
    group.add(currentMesh)
  }

  function cycleVehicle(){
    const keys = Object.keys(builders) as Array<keyof typeof builders>
    const i = keys.indexOf(currentKey)
    setVehicle(keys[(i+1)%keys.length])
  }

  return { group, controller, setVehicle, cycleVehicle }
}
