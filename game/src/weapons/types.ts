import * as THREE from 'three'

//1.- Shared type for targetable entities used by the weapon simulations.
export type WeaponTarget = {
  id: string
  position: THREE.Vector3
  velocity: THREE.Vector3
  alive: boolean
  onFire?: boolean
  falling?: boolean
}

//2.- Context handed to weapons so they can reason about the shooter pose and available targets.
export type WeaponContext = {
  position: THREE.Vector3
  forward: THREE.Vector3
  dt: number
  targets: WeaponTarget[]
}

//3.- Extension that provides optional terrain sampling used by ground-interacting ordnance.
export type GroundedWeaponContext = WeaponContext & {
  sampleGroundHeight?: (x: number, z: number) => number
}
