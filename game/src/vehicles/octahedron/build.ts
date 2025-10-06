import * as THREE from 'three'
export function buildOctahedron(){
  const g = new THREE.OctahedronGeometry(3, 0)
  const m = new THREE.MeshStandardMaterial({ color: 0x87cefa, roughness: 0.45, metalness: 0.35 })
  return new THREE.Mesh(g, m)
}
