import * as THREE from 'three'
export function buildIcosahedron(){
  const g = new THREE.IcosahedronGeometry(3.2, 0)
  const m = new THREE.MeshStandardMaterial({ color: 0xb0e0e6, roughness: 0.45, metalness: 0.35 })
  return new THREE.Mesh(g, m)
}
