// TerrainStreamer.ts
import * as THREE from 'three'
import { heightAt, normalAt } from './generateHeight'
import { getDifficultyState, onDifficultyChange } from '@/engine/difficulty'
import { configureWorldSeeds, getWorldSeedSnapshot } from './worldSeed'

// ✅ merge helper must be imported from examples utils (not THREE namespace)
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/* ──────────────────────────────────────────────────────────────────────────
   CONFIG
   ────────────────────────────────────────────────────────────────────────── */
const CHUNK_SIZE = 512
const GRID_SEGMENTS = 100              // PlaneGeometry(..., wSegs, hSegs)
const ACTIVE_RADIUS = 5                // in chunks (Chebyshev distance)
const FADE_DURATION = 1.0              // seconds
const SKIRT_DROP = 12                  // vertical extrusion to hide transient gaps
const TILE_REPEAT = 8                  // UV tiling for the terrain texture
const ROCKS_PER_DENSITY_UNIT = 16      // propDensity × this

/* ──────────────────────────────────────────────────────────────────────────
   UTILITIES
   ────────────────────────────────────────────────────────────────────────── */
const HALF = CHUNK_SIZE / 2
const key = (ix: number, iz: number) => `${ix},${iz}`
const toChunk = (x: number) => Math.floor(x / CHUNK_SIZE)

// Stable seeded RNG so decorations don’t “pop” when re-decorating
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hash2i = (a: number, b: number) => {
  // simple 2D int hash → int
  let h = a | 0
  h = Math.imul(h ^ 0x9e3779b1, 0x85ebca6b)
  h ^= b | 0
  h = Math.imul(h ^ 0xc2b2ae35, 0x27d4eb2f)
  return h >>> 0
}

/* ──────────────────────────────────────────────────────────────────────────
   SHARED RESOURCES
   ────────────────────────────────────────────────────────────────────────── */
let envCache = getDifficultyState().environment

// Base/shared materials & geometries (cloned where per-mesh state is needed)
const shared = {
  terrainBase: new THREE.MeshStandardMaterial({
    color: 0x506a52,
    roughness: 0.95,
    metalness: 0,
    transparent: true, // we fade per-chunk
    opacity: 1.0,
    dithering: true,
  }),
  rockMat: new THREE.MeshStandardMaterial({
    color: 0x4a4f44,
    roughness: 0.8,
    metalness: 0.1,
  }),
  rockGeo: new THREE.IcosahedronGeometry(2.0, 1), // reused across chunks
}

/* ──────────────────────────────────────────────────────────────────────────
   GEOMETRY BUILDERS
   ────────────────────────────────────────────────────────────────────────── */

// 1) Build the main height-mapped plane
function buildTerrainPlane(ix: number, iz: number) {
  // Note: wSegs/hSegs === GRID_SEGMENTS → (GRID_SEGMENTS+1)^2 vertices
  const g = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, GRID_SEGMENTS, GRID_SEGMENTS)
  g.rotateX(-Math.PI / 2)

  const pos = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i) + ix * CHUNK_SIZE
    const vz = pos.getZ(i) + iz * CHUNK_SIZE
    pos.setY(i, heightAt(vx, vz))
  }
  pos.needsUpdate = true

  // UV tiling for the color map
  const uv = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * TILE_REPEAT, uv.getY(i) * TILE_REPEAT)
  }
  uv.needsUpdate = true

  g.computeVertexNormals()
  return g
}

// 2) Build a vertical “skirt” ring around the chunk edges, welded to the top edge
function buildSkirt(ix: number, iz: number) {
  // Each side has GRID_SEGMENTS segments ⇒ GRID_SEGMENTS+1 edge vertices
  const edgeVerts = GRID_SEGMENTS + 1
  const seg = CHUNK_SIZE / GRID_SEGMENTS

  // We’ll create 4 sides, each with a strip of (edgeVerts) quads = (edgeVerts-1)*2 triangles
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  // helper to push a vertical pair (top,bottom) and return the index of the TOP
  const pushPair = (xLocal: number, zLocal: number) => {
    const worldX = ix * CHUNK_SIZE + xLocal
    const worldZ = iz * CHUNK_SIZE + zLocal
    const topY = heightAt(worldX, worldZ)
    const bottomY = topY - SKIRT_DROP

    const baseIdx = positions.length / 3
    // top
    positions.push(xLocal, topY, zLocal)
    uvs.push((xLocal + HALF) / CHUNK_SIZE, (zLocal + HALF) / CHUNK_SIZE)
    // bottom
    positions.push(xLocal, bottomY, zLocal)
    uvs.push((xLocal + HALF) / CHUNK_SIZE, (zLocal + HALF) / CHUNK_SIZE)

    return baseIdx // index of the top; bottom is baseIdx+1
  }

  // helper to connect two consecutive pairs as a vertical quad
  const pushQuad = (iTopA: number, iTopB: number) => {
    const iBotA = iTopA + 1
    const iBotB = iTopB + 1
    indices.push(iTopA, iTopB, iBotB)
    indices.push(iTopA, iBotB, iBotA)
  }

  // top edge (z = +HALF), left→right
  let prevTop = pushPair(-HALF, +HALF)
  for (let i = 1; i < edgeVerts; i++) {
    const x = -HALF + i * seg
    const nextTop = pushPair(x, +HALF)
    pushQuad(prevTop, nextTop)
    prevTop = nextTop
  }

  // right edge (x = +HALF), top→bottom
  prevTop = pushPair(+HALF, +HALF)
  for (let i = 1; i < edgeVerts; i++) {
    const z = +HALF - i * seg
    const nextTop = pushPair(+HALF, z)
    pushQuad(prevTop, nextTop)
    prevTop = nextTop
  }

  // bottom edge (z = -HALF), right→left
  prevTop = pushPair(+HALF, -HALF)
  for (let i = 1; i < edgeVerts; i++) {
    const x = +HALF - i * seg
    const nextTop = pushPair(x, -HALF)
    pushQuad(prevTop, nextTop)
    prevTop = nextTop
  }

  // left edge (x = -HALF), bottom→top
  prevTop = pushPair(-HALF, -HALF)
  for (let i = 1; i < edgeVerts; i++) {
    const z = -HALF + i * seg
    const nextTop = pushPair(-HALF, z)
    pushQuad(prevTop, nextTop)
    prevTop = nextTop
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

// 3) Build a full chunk geometry = terrain plane + skirt
function buildChunkGeometry(ix: number, iz: number) {
  const plane = buildTerrainPlane(ix, iz)
  const skirt = buildSkirt(ix, iz)
  const merged = mergeGeometries([plane, skirt], false)!
  merged.computeVertexNormals()
  plane.dispose()
  skirt.dispose()
  return merged
}

/* ──────────────────────────────────────────────────────────────────────────
   DECORATIONS
   ────────────────────────────────────────────────────────────────────────── */
function decorateChunk(mesh: THREE.Mesh) {
  // Clear previous decorations (safe dispose)
  const previous = mesh.userData.decorations as THREE.Object3D[] | undefined
  if (previous?.length) {
    for (const obj of previous) {
      mesh.remove(obj)
      if (obj instanceof THREE.InstancedMesh) {
        obj.geometry.dispose()
        obj.dispose()
      } else {
        obj.traverse((c) => {
          if ((c as any).geometry) (c as THREE.Mesh).geometry.dispose()
          const m = (c as THREE.Mesh).material
          if (Array.isArray(m)) m.forEach((mm) => mm.dispose?.())
          else (m as any)?.dispose?.()
        })
      }
    }
  }
  mesh.userData.decorations = []

  const { propDensity } = envCache
  const propCount = Math.max(0, Math.round(propDensity * ROCKS_PER_DENSITY_UNIT))
  if (propCount === 0) return

  // Deterministic scatter per chunk
  const { decorationSeed } = getWorldSeedSnapshot()
  const seed = hash2i(mesh.userData.ix ^ decorationSeed, mesh.userData.iz ^ (decorationSeed >>> 1))
  const rand = mulberry32(seed)

  const inst = new THREE.InstancedMesh(shared.rockGeo, shared.rockMat, propCount)
  const mat = new THREE.Matrix4()
  const p = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  const n = new THREE.Vector3()

  for (let i = 0; i < propCount; i++) {
    const localX = (rand() - 0.5) * CHUNK_SIZE
    const localZ = (rand() - 0.5) * CHUNK_SIZE
    const worldX = mesh.userData.ix * CHUNK_SIZE + localX
    const worldZ = mesh.userData.iz * CHUNK_SIZE + localZ
    const y = heightAt(worldX, worldZ) + 0.6 + rand() * 0.4

    p.set(localX, y, localZ)

    const nn = normalAt(worldX, worldZ)
    n.set(nn.x, nn.y, nn.z).normalize()
    const align = new THREE.Quaternion().setFromUnitVectors(up, n)

    // small random rotation around normal
    q.setFromAxisAngle(n, rand() * Math.PI * 2)
    q.premultiply(align)

    const k = 0.8 + rand() * 0.5
    s.set(k, k, k)

    mat.compose(p, q, s)
    inst.setMatrixAt(i, mat)
  }
  inst.instanceMatrix.needsUpdate = true
  inst.castShadow = true
  inst.frustumCulled = false

  mesh.add(inst)
  mesh.userData.decorations.push(inst)
}

/* ──────────────────────────────────────────────────────────────────────────
   CHUNK BUILDER
   ────────────────────────────────────────────────────────────────────────── */
function buildChunk(ix: number, iz: number, textureMap: THREE.Texture | null) {
  const geo = buildChunkGeometry(ix, iz)

  // ❗ per-chunk material clone so fades don’t affect *all* chunks
  const mat = shared.terrainBase.clone()
  mat.map = textureMap ?? null
  mat.needsUpdate = true

  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(ix * CHUNK_SIZE, 0, iz * CHUNK_SIZE)
  mesh.receiveShadow = true
  mesh.frustumCulled = false // safer for large, deformed tiles

  mesh.userData = {
    ix,
    iz,
    decorations: [] as THREE.Object3D[],
    fade: { t: 0, from: 0, to: 1, start: 0 }, // per-chunk fade state
    removing: false,                           // when true, fade to 0 then dispose
    seedSignature: getWorldSeedSnapshot().decorationSeed,
  }

  // start invisible; we’ll fade in from 0 → 1
  ;(mesh.material as THREE.MeshStandardMaterial).opacity = 0
  decorateChunk(mesh)
  return mesh
}

/* ──────────────────────────────────────────────────────────────────────────
   STREAMER
   ────────────────────────────────────────────────────────────────────────── */
type StreamerOptions = {
  worldId?: string
  mapId?: string
}

export function createStreamer(scene: THREE.Scene, options: StreamerOptions = {}) {
  //1.- Persist the negotiated identifiers so procedural noise and decoration RNG stay in lockstep across clients.
  configureWorldSeeds({ worldId: options.worldId, mapId: options.mapId })

  const chunks = new Map<string, THREE.Mesh>()
  const tmp = new THREE.Vector3()
  const clock = new THREE.Clock()
  let environmentDirty = false

  // ── Texture load (asynchronously); newly created chunks will receive it immediately
  let terrainMap: THREE.Texture | null = null
  new THREE.TextureLoader().load(
    '/textures/32d4a6ff-3da1-4c7c-a742-1d1fa759e394.png',
    (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      // NOTE: three r152+: set colorSpace on texture instead of encoding
      ;(tex as any).colorSpace = (THREE as any).SRGBColorSpace ?? undefined
      tex.anisotropy = 8
      terrainMap = tex

      // Update existing chunk materials to use the map
      for (const m of chunks.values()) {
        const mm = m.material as THREE.MeshStandardMaterial
        mm.map = tex
        mm.needsUpdate = true
      }
    },
    undefined,
    (err) => console.warn('Terrain texture failed to load; using flat color', err),
  )

  // ── React to difficulty / environment changes
  const unsubscribe = onDifficultyChange((state) => {
    envCache = state.environment
    environmentDirty = true
  })

  // ── Ensure a chunk exists
  function ensure(ix: number, iz: number) {
    const k = key(ix, iz)
    if (chunks.has(k)) return
    const mesh = buildChunk(ix, iz, terrainMap)
    // schedule fade in
    mesh.userData.fade = { t: 0, from: 0, to: 1, start: clock.getElapsedTime() }
    scene.add(mesh)
    chunks.set(k, mesh)
  }

  // ── Mark distant chunks to remove (we’ll fade them in update loop)
  function markForRemoval(centerX: number, centerZ: number, radius: number) {
    const cx = toChunk(centerX)
    const cz = toChunk(centerZ)
    for (const [k, m] of chunks) {
      const dx = cx - m.userData.ix
      const dz = cz - m.userData.iz
      const dist = Math.max(Math.abs(dx), Math.abs(dz))
      if (dist > radius && !m.userData.removing) {
        m.userData.removing = true
        m.userData.fade = { t: 0, from: (m.material as THREE.MeshStandardMaterial).opacity, to: 0, start: clock.getElapsedTime() }
      }
    }
  }

  // ── Fade step (both in & out), and dispose out-faded chunks
  function stepFades(now: number) {
    const toDelete: string[] = []
    for (const [k, m] of chunks) {
      const f = m.userData.fade as { t: number; from: number; to: number; start: number }
      if (!f) continue
      const mm = m.material as THREE.MeshStandardMaterial

      const elapsed = now - f.start
      const t = THREE.MathUtils.clamp(elapsed / FADE_DURATION, 0, 1)
      mm.opacity = THREE.MathUtils.lerp(f.from, f.to, t)

      if (t >= 1) {
        // if we just faded out, remove & dispose
        if (m.userData.removing) {
          scene.remove(m)
          disposeChunk(m)
          chunks.delete(k)
        } else {
          // fade-in finished; clear fade marker
          m.userData.fade = null
        }
      }
    }
  }

  // ── Dispose a whole chunk safely
  function disposeChunk(mesh: THREE.Mesh) {
    mesh.geometry.dispose()

    // dispose *per-chunk clone* of terrain material
    const mm = mesh.material as THREE.MeshStandardMaterial
    if (mm.map && mm.map !== terrainMap) mm.map.dispose()
    mm.dispose()

    // decorations
    const decos = mesh.userData.decorations as THREE.Object3D[] | undefined
    for (const d of decos ?? []) {
      if (d instanceof THREE.InstancedMesh) {
        d.geometry.dispose()
        d.dispose()
      } else {
        d.traverse((c) => {
          if ((c as any).geometry) (c as THREE.Mesh).geometry.dispose()
          const mat = (c as THREE.Mesh).material
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.())
          else (mat as any)?.dispose?.()
        })
      }
      mesh.remove(d)
    }
    mesh.userData.decorations = []
  }

  return {
    update(pos: THREE.Vector3, dt = 0) {
      // radius can adjust with density if you wish; keep simple & stable here
      const radius = ACTIVE_RADIUS
      const cx = toChunk(pos.x)
      const cz = toChunk(pos.z)

      // create/keep a square of chunks around the player
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          ensure(cx + dx, cz + dz)
        }
      }

      // mark far chunks for fade-out/removal
      markForRemoval(pos.x, pos.z, radius)

      // re-decorate after env change (seeded → no popping)
      if (environmentDirty) {
        for (const m of chunks.values()) decorateChunk(m)
        environmentDirty = false
      }

      //1.- Combine the monotonically increasing clock time with the supplied dt so fades stay smooth during
      //    deterministic test runs where requestAnimationFrame never fires.
      const now = clock.getElapsedTime() + dt

      //2.- Advance chunk fade transitions using the resolved timestamp, guaranteeing consistent cross-environment visuals.
      stepFades(now)
    },

    queryHeight(x: number, z: number) {
      return heightAt(x, z)
    },

    queryNormal(x: number, z: number) {
      const n = normalAt(x, z)
      return tmp.set(n.x, n.y, n.z)
    },

    dispose() {
      unsubscribe?.()
      for (const m of chunks.values()) disposeChunk(m)
      chunks.clear()

      // shared resources: don’t dispose shared.terrainBase (used as template)
      shared.rockGeo.dispose()
      shared.rockMat.dispose()

      if (terrainMap) {
        terrainMap.dispose()
        terrainMap = null
      }
    },
  }
}
