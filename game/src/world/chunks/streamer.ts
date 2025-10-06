import * as THREE from 'three'
import { heightAt, normalAt } from './generateHeight'

const CHUNK_SIZE = 128
const VERTS = 64
const HALF = CHUNK_SIZE/2

function key(ix:number, iz:number){ return ix+','+iz }
function toChunk(x:number){ return Math.floor(x / CHUNK_SIZE) }

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
  mesh.userData = { ix, iz }
  return mesh
}

export function createStreamer(scene: THREE.Scene){
  const chunks = new Map<string, THREE.Mesh>()
  const activeRadius = 2 // 5x5 ring (0,1,2)
  const tmp = new THREE.Vector3()

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
    },
    queryHeight(x:number,z:number){
      return heightAt(x,z)
    },
    queryNormal(x:number,z:number){
      const n = normalAt(x,z)
      return tmp.set(n.x, n.y, n.z)
    }
  }
}
