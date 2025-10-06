import * as THREE from 'three'

export function createPolyBoss(scene: THREE.Scene, position: THREE.Vector3){
  const geo = new THREE.IcosahedronGeometry(28, 1)
  const mat = new THREE.MeshStandardMaterial({ color: 0x3344ff, roughness: 0.4, metalness: 0.3, emissive: 0x000033 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.copy(position)
  scene.add(mesh)
  const state = { phase: 1, hp: 600, t: 0 }
  return {
    mesh,
    update(dt:number){
      state.t += dt
      mesh.rotation.y += dt*0.4
      mesh.rotation.x += dt*0.2
      // TODO: sweep lasers / spawn adds
    },
    onDeath(){
      scene.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose?.()
    }
  }
}
