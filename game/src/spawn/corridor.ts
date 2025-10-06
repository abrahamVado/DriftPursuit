import * as THREE from 'three'
export function createCorridor(scene: THREE.Scene){
  const len = 1000
  const width = 80
  const height = 60
  const geo = new THREE.BoxGeometry(width, height, len)
  const mat = new THREE.MeshStandardMaterial({ color: 0x1a1f29, metalness: 0.1, roughness: 0.8 })
  const tunnel = new THREE.Mesh(geo, mat)
  tunnel.position.set(0, 80, -len/2 - 100)
  tunnel.receiveShadow = true
  tunnel.castShadow = false
  scene.add(tunnel)
  return { tunnel }
}
