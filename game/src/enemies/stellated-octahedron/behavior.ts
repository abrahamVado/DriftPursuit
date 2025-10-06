import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

function buildStellatedOctahedron(size=6){
  //1.- Build a pair of tetrahedra whose rotations mirror the stella octangula shape.
  const tetraPrimary = new THREE.TetrahedronGeometry(size, 0)
  const tetraSecondary = tetraPrimary.clone()
  tetraSecondary.rotateX(Math.PI)
  tetraSecondary.rotateZ(Math.PI/2)

  //2.- Combine the tetrahedra into a single buffer geometry for efficient rendering.
  const merged = mergeGeometries([tetraPrimary, tetraSecondary], false)
  const geometry = merged ?? tetraPrimary
  if (merged) {
    tetraPrimary.dispose()
  }
  tetraSecondary.dispose()

  //3.- Wrap the merged geometry in a material tuned for the enemy aesthetic.
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xff5533, metalness: 0.2, roughness: 0.6, emissive: 0x220000 }))
}

export function createEnemy(scene: THREE.Scene, position: THREE.Vector3){
  //4.- Materialise the mesh, position it, and append it to the active scene graph.
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
  //5.- Track the enemy so the wave manager can iterate and update per frame.
  ;(scene as any).__enemies ??= []
  ;(scene as any).__enemies.push(obj)
  return obj
}

export function updateEnemies(scene: THREE.Scene, dt:number){
  //6.- Advance each tracked enemy AI using the shared scene registry.
  const arr = (scene as any).__enemies as any[] | undefined
  if (!arr) return
  for (const e of arr) e.update(dt)
}
