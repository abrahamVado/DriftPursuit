import * as THREE from 'three'

function buildStellatedOctahedron(size=6){
  // Build stella octangula by combining two tetrahedra
  const tetra = new THREE.TetrahedronGeometry(size, 0)
  const m1 = new THREE.Mesh(tetra)
  const m2 = new THREE.Mesh(tetra)
  m2.rotation.set(Math.PI, 0, Math.PI/2)
  const g = new THREE.BufferGeometry()
  // merge geometries
  g.copy((new THREE.Mesh(tetra)).geometry)
  const g2 = (new THREE.Mesh(tetra)).geometry.clone()
  g2.rotateX(Math.PI); g2.rotateZ(Math.PI/2)
  g.merge(g2, 0)
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xff5533, metalness: 0.2, roughness: 0.6, emissive: 0x220000 }))
}

export function createEnemy(scene: THREE.Scene, position: THREE.Vector3){
  const mesh = buildStellatedOctahedron(5)
  mesh.position.copy(position)
  scene.add(mesh)
  const vel = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const tmp = new THREE.Vector3()
  const obj = {
    mesh,
    hp: 40,
    target: undefined as THREE.Object3D | undefined,
    update(dt:number){
      if (this.target){
        dir.copy(this.target.position).sub(mesh.position).normalize()
        vel.addScaledVector(dir, 20*dt)
        vel.clampLength(0, 40)
        mesh.position.addScaledVector(vel, dt)
        mesh.lookAt(this.target.position)
      }
    },
    onDeath(){
      scene.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose?.()
    }
  }
  ;(scene as any).__enemies ??= []
  ;(scene as any).__enemies.push(obj)
  return obj
}

export function updateEnemies(scene: THREE.Scene, dt:number){
  const arr = (scene as any).__enemies as any[] | undefined
  if (!arr) return
  for (const e of arr) e.update(dt)
}
