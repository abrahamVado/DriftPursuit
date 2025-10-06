import * as THREE from 'three'
export function buildPyramid(){
  const g = new THREE.ConeGeometry(3.2, 5.5, 4)
  const m = new THREE.MeshStandardMaterial({ color: 0xcd5c5c, roughness: 0.6, metalness: 0.2 })
  const mesh = new THREE.Mesh(g, m)
  mesh.rotateX(Math.PI/2)
  return mesh
}
