import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createPlayer } from '@/vehicles/shared/player'

export function testPlayerVehicleCreation(): void {
  //1.- Instantiate the scene and player to ensure the octahedron builder resolves correctly.
  const scene = new THREE.Scene()
  const { group, setVehicle, cycleVehicle } = createPlayer('octahedron', scene)
  assert(scene.children.includes(group), 'Expected the player group to be attached to the scene')
  const initialChildCount = group.children.length
  assert(initialChildCount > 0, 'Expected an initial vehicle mesh to be present')

  //2.- Switch the vehicle explicitly and via cycling to confirm builder lookups remain stable.
  setVehicle('cube')
  assert(group.children.length > 0, 'Expected a cube mesh to populate after switching')
  cycleVehicle()
  assert(group.children.length > 0, 'Expected a mesh to remain attached after cycling vehicles')
}
