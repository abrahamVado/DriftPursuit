import * as THREE from 'three'

function disposeMeshLike(object: THREE.Object3D){
  //1.- Traverse any composed mesh tree and release GPU buffers and materials.
  const disposedMaterials = new Set<THREE.Material>()
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.geometry.dispose()
    const material = child.material
    if (Array.isArray(material)) {
      for (const mat of material){
        if (!disposedMaterials.has(mat)){
          mat.dispose?.()
          disposedMaterials.add(mat)
        }
      }
    } else if (!disposedMaterials.has(material)) {
      material.dispose?.()
      disposedMaterials.add(material)
    }
  })
}

function buildStellatedOctahedron(size=6){
  //1.- Construct standalone tetrahedra so modern BufferGeometry APIs never rely on the removed Geometry.merge helper.
  const orientations: Array<(geometry: THREE.TetrahedronGeometry) => void> = [
    //2.- Keep the first tetrahedron untouched and spin the second to mirror the stellated octahedron silhouette.
    (_geometry) => {},
    (geometry) => {
      geometry.rotateX(Math.PI)
      geometry.rotateZ(Math.PI / 2)
    }
  ]

  //3.- Wrap the oriented geometries in meshes and collect them in a group for shared transforms.
  const material = new THREE.MeshStandardMaterial({ color: 0xff5533, metalness: 0.2, roughness: 0.6, emissive: 0x220000 })
  const group = new THREE.Group()
  for (const orient of orientations){
    const geometry = new THREE.TetrahedronGeometry(size, 0)
    orient(geometry)
    group.add(new THREE.Mesh(geometry, material))
  }
  return group
}

export function createEnemy(scene: THREE.Scene, position: THREE.Vector3){
  //1.- Materialise the mesh, position it, and append it to the active scene graph.
  const mesh = buildStellatedOctahedron(5)
  mesh.position.copy(position)
  scene.add(mesh)
  const vel = new THREE.Vector3()
  const dir = new THREE.Vector3()
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
      disposeMeshLike(mesh)
    }
  }
  //2.- Track the enemy so the wave manager can iterate and update per frame.
  ;(scene as any).__enemies ??= []
  ;(scene as any).__enemies.push(obj)
  return obj
}

export function updateEnemies(scene: THREE.Scene, dt:number){
  //1.- Advance each tracked enemy AI using the shared scene registry.
  const arr = (scene as any).__enemies as any[] | undefined
  if (!arr) return
  for (const e of arr) e.update(dt)
}
