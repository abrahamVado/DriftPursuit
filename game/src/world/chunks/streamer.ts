import * as THREE from 'three'
import { heightAt, normalAt } from './generateHeight'
import { getDifficultyState, onDifficultyChange } from '@/engine/difficulty'

const CHUNK_SIZE = 128
const VERTS = 64
const HALF = CHUNK_SIZE/2

function key(ix:number, iz:number){ return ix+','+iz }
function toChunk(x:number){ return Math.floor(x / CHUNK_SIZE) }

let envCache = getDifficultyState().environment

function buildChunk(ix:number, iz:number){
  const g = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, VERTS, VERTS)
  g.rotateX(-Math.PI/2)
  const pos = g.attributes.position as THREE.BufferAttribute
  for(let i=0;i<pos.count;i++){
    const vx = pos.getX(i) + ix*CHUNK_SIZE
    const vz = pos.getZ(i) + iz*CHUNK_SIZE
    const h = heightAt(vx, vz)
    pos.setY(i, h)
  }
  pos.needsUpdate = true
  g.computeVertexNormals()

  const mat = new THREE.MeshStandardMaterial({
    color: 0x506a52,
    roughness: 0.95,
    metalness: 0.0
  })
  const mesh = new THREE.Mesh(g, mat)
  mesh.position.set(ix*CHUNK_SIZE, 0, iz*CHUNK_SIZE)
  mesh.receiveShadow = true
  mesh.userData = { ix, iz, decorations: [] as THREE.Object3D[] }
  decorateChunk(mesh)
  return mesh
}

function decorateChunk(mesh: THREE.Mesh){
  //1.- Clear any existing decoration objects so density changes can rebuild them idempotently.
  const previous: THREE.Object3D[] = mesh.userData.decorations ?? []
  for (const obj of previous) {
    mesh.remove(obj)
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        const material = child.material
        if (Array.isArray(material)) {
          for (const mat of material) mat.dispose?.()
        } else {
          material.dispose?.()
        }
      }
    })
  }

  const decorations: THREE.Object3D[] = []
  const { propDensity, windStrength } = envCache
  const propCount = Math.max(0, Math.round(propDensity * 4))
  for (let i = 0; i < propCount; i++) {
    const rock = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2 + Math.random() * 3, 0),
      new THREE.MeshStandardMaterial({ color: 0x4a4f44, roughness: 0.8 })
    )
    const localX = (Math.random() - 0.5) * CHUNK_SIZE
    const localZ = (Math.random() - 0.5) * CHUNK_SIZE
    const worldX = mesh.userData.ix * CHUNK_SIZE + localX
    const worldZ = mesh.userData.iz * CHUNK_SIZE + localZ
    const baseHeight = heightAt(worldX, worldZ) - mesh.position.y
    rock.position.set(localX, baseHeight + 1.6, localZ)
    decorations.push(rock)
  }

  const windCount = Math.max(1, Math.round(windStrength))
  for (let i = 0; i < windCount; i++) {
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(3 + windStrength, 3 + windStrength, 90 + windStrength * 10, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x88ccff, transparent: true, opacity: 0.18 })
    )
    const localX = (Math.random() - 0.5) * CHUNK_SIZE
    const localZ = (Math.random() - 0.5) * CHUNK_SIZE
    column.position.set(localX, 45, localZ)
    column.rotation.x = Math.PI / 2
    decorations.push(column)
  }

  for (const deco of decorations) {
    mesh.add(deco)
  }
  mesh.userData.decorations = decorations
}

export function createStreamer(scene: THREE.Scene){
  const chunks = new Map<string, THREE.Mesh>()
  const activeRadius = 2 // 5x5 ring (0,1,2)
  const tmp = new THREE.Vector3()
  let environmentDirty = false
  const unsubscribe = onDifficultyChange((state) => {
    //1.- Mark existing chunks dirty so the next update rebuilds their decoration sets.
    envCache = state.environment
    environmentDirty = true
  })

  function ensure(ix:number, iz:number){
    const k = key(ix, iz)
    if (chunks.has(k)) return
    const m = buildChunk(ix, iz)
    chunks.set(k, m)
    scene.add(m)
  }

  function prune(centerX:number, centerZ:number){
    for(const [k, m] of chunks){
      const dx = toChunk(centerX) - m.userData.ix
      const dz = toChunk(centerZ) - m.userData.iz
      if (Math.abs(dx) > activeRadius || Math.abs(dz) > activeRadius){
        scene.remove(m)
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose?.()
        const decorations: THREE.Object3D[] = m.userData.decorations ?? []
        for (const deco of decorations) {
          scene.remove(deco)
          deco.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.geometry.dispose()
              const material = child.material
              if (Array.isArray(material)) {
                for (const mat of material) mat.dispose?.()
              } else {
                material.dispose?.()
              }
            }
          })
        }
        chunks.delete(k)
      }
    }
  }

  return {
    update(pos: THREE.Vector3){
      const cx = toChunk(pos.x)
      const cz = toChunk(pos.z)
      for(let dz=-activeRadius; dz<=activeRadius; dz++){
        for(let dx=-activeRadius; dx<=activeRadius; dx++){
          ensure(cx+dx, cz+dz)
        }
      }
      prune(pos.x, pos.z)
      if (environmentDirty) {
        for (const mesh of chunks.values()) {
          decorateChunk(mesh)
        }
        environmentDirty = false
      }
    },
    queryHeight(x:number,z:number){
      return heightAt(x,z)
    },
    queryNormal(x:number,z:number){
      const n = normalAt(x,z)
      return tmp.set(n.x, n.y, n.z)
    },
    dispose(){
      //1.- Allow manual disposal to release the difficulty subscription when the streamer is torn down.
      unsubscribe?.()
    }
  }
}
