import * as THREE from 'three'
export function buildCube(){
  const g = new THREE.BoxGeometry(4, 4, 4)
  const m = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, roughness: 0.5, metalness: 0.25 })
  return new THREE.Mesh(g, m)
}
