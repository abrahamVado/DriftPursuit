import * as THREE from 'three'
export function buildArrowhead(){
  const g = new THREE.ConeGeometry(2.2, 7, 4)
  g.rotateX(Math.PI/2)
  const m = new THREE.MeshStandardMaterial({ color: 0xff7f50, roughness: 0.5, metalness: 0.3, emissive: 0x220a00 })
  const hull = new THREE.Mesh(g, m)
  const group = new THREE.Group()
  group.add(hull)
  const wing = new THREE.Mesh(new THREE.BoxGeometry(8,0.3,1.5), new THREE.MeshStandardMaterial({ color: 0x22272f }))
  wing.position.set(0,0,-1.5)
  group.add(wing)
  return group
}
