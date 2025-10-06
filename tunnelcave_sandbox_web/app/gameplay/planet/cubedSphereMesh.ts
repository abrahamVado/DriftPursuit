import * as THREE from 'three'

export interface CubedSphereFace {
  readonly vertexIndices: readonly (readonly number[])[]
}

export interface CubedSphereMesh {
  readonly subdivisions: number
  readonly vertices: Float32Array
  readonly indices: Uint32Array
  readonly faces: readonly CubedSphereFace[]
}

interface FaceDefinition {
  readonly normal: THREE.Vector3
  readonly uAxis: THREE.Vector3
  readonly vAxis: THREE.Vector3
}

const FACE_DEFINITIONS: readonly FaceDefinition[] = [
  //1.- Six axis-aligned cube faces with a right-handed (u, v, normal) basis.
  { normal: new THREE.Vector3(1, 0, 0), uAxis: new THREE.Vector3(0, 0, -1), vAxis: new THREE.Vector3(0, 1, 0) },
  { normal: new THREE.Vector3(-1, 0, 0), uAxis: new THREE.Vector3(0, 0, 1), vAxis: new THREE.Vector3(0, 1, 0) },
  { normal: new THREE.Vector3(0, 1, 0), uAxis: new THREE.Vector3(-1, 0, 0), vAxis: new THREE.Vector3(0, 0, 1) },
  { normal: new THREE.Vector3(0, -1, 0), uAxis: new THREE.Vector3(-1, 0, 0), vAxis: new THREE.Vector3(0, 0, -1) },
  { normal: new THREE.Vector3(0, 0, 1), uAxis: new THREE.Vector3(1, 0, 0), vAxis: new THREE.Vector3(0, 1, 0) },
  { normal: new THREE.Vector3(0, 0, -1), uAxis: new THREE.Vector3(-1, 0, 0), vAxis: new THREE.Vector3(0, 1, 0) },
]

function buildVertexKey(vector: THREE.Vector3): string {
  //1.- Quantise direction vectors to guarantee seam vertices resolve to a shared key.
  return `${vector.x.toFixed(10)},${vector.y.toFixed(10)},${vector.z.toFixed(10)}`
}

function computeFacePoint(
  face: FaceDefinition,
  uIndex: number,
  vIndex: number,
  subdivisions: number,
  scratch: THREE.Vector3
): THREE.Vector3 {
  //1.- Remap lattice coordinates into the canonical [-1, 1] parametric domain.
  const u = subdivisions === 0 ? 0 : -1 + (2 * uIndex) / subdivisions
  const v = subdivisions === 0 ? 0 : -1 + (2 * vIndex) / subdivisions
  //2.- Assemble the cube point before projecting onto the unit sphere.
  scratch.copy(face.normal)
  scratch.x += face.uAxis.x * u + face.vAxis.x * v
  scratch.y += face.uAxis.y * u + face.vAxis.y * v
  scratch.z += face.uAxis.z * u + face.vAxis.z * v
  scratch.normalize()
  return scratch
}

function pushTriangle(
  indices: number[],
  a: number,
  b: number,
  c: number,
  vertices: number[]
): void {
  //1.- Fetch vertex positions for winding analysis.
  const ax = vertices[a * 3]
  const ay = vertices[a * 3 + 1]
  const az = vertices[a * 3 + 2]
  const bx = vertices[b * 3]
  const by = vertices[b * 3 + 1]
  const bz = vertices[b * 3 + 2]
  const cx = vertices[c * 3]
  const cy = vertices[c * 3 + 1]
  const cz = vertices[c * 3 + 2]
  //2.- Evaluate the triangle normal to ensure the winding points away from the origin.
  const abx = bx - ax
  const aby = by - ay
  const abz = bz - az
  const acx = cx - ax
  const acy = cy - ay
  const acz = cz - az
  const nx = aby * acz - abz * acy
  const ny = abz * acx - abx * acz
  const nz = abx * acy - aby * acx
  const dot = nx * (ax + bx + cx) + ny * (ay + by + cy) + nz * (az + bz + cz)
  if (dot < 0) {
    indices.push(a, c, b)
  } else {
    indices.push(a, b, c)
  }
}

export function generateCubedSphereMesh(subdivisions: number): CubedSphereMesh {
  //1.- Accumulate vertices while deduplicating seams across cube faces.
  const vertices: number[] = []
  const indices: number[] = []
  const vertexLookup = new Map<string, number>()
  const faces: CubedSphereFace[] = []
  const scratch = new THREE.Vector3()
  for (const faceDefinition of FACE_DEFINITIONS) {
    const grid: number[][] = []
    for (let v = 0; v <= subdivisions; v += 1) {
      const row: number[] = []
      for (let u = 0; u <= subdivisions; u += 1) {
        const point = computeFacePoint(faceDefinition, u, v, subdivisions, scratch)
        const key = buildVertexKey(point)
        let index = vertexLookup.get(key)
        if (index === undefined) {
          index = vertices.length / 3
          vertices.push(point.x, point.y, point.z)
          vertexLookup.set(key, index)
        }
        row.push(index)
      }
      grid.push(row)
    }
    faces.push({ vertexIndices: grid.map((entries) => Object.freeze([...entries])) })
  }
  //2.- Create triangles for each quad cell while enforcing outward-facing winding.
  for (const face of faces) {
    const grid = face.vertexIndices
    const rows = grid.length - 1
    const columns = grid[0].length - 1
    for (let v = 0; v < rows; v += 1) {
      for (let u = 0; u < columns; u += 1) {
        const a = grid[v][u]
        const b = grid[v][u + 1]
        const c = grid[v + 1][u]
        const d = grid[v + 1][u + 1]
        pushTriangle(indices, a, b, c, vertices)
        pushTriangle(indices, b, d, c, vertices)
      }
    }
  }
  return Object.freeze({
    subdivisions,
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    faces: Object.freeze(faces.map((face) => Object.freeze({ vertexIndices: face.vertexIndices }))),
  })
}

export function createFixedCubedSphereLods(levels: readonly number[]): readonly CubedSphereMesh[] {
  //1.- Validate the requested LOD set so downstream systems do not work with an empty catalogue.
  if (levels.length === 0) {
    throw new Error('At least one LOD level is required to build cubed-sphere meshes')
  }
  //2.- Deduplicate exponents while preserving caller intent before generating meshes.
  const uniqueLevels = Array.from(new Set(levels)).sort((a, b) => a - b)
  const meshes = uniqueLevels.map((level) => {
    const subdivisions = Math.max(1, 2 ** level)
    return generateCubedSphereMesh(subdivisions)
  })
  return Object.freeze(meshes)
}
