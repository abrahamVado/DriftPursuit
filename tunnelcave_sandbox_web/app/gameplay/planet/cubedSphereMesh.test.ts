import { describe, expect, it } from 'vitest'
import { createFixedCubedSphereLods, generateCubedSphereMesh } from './cubedSphereMesh'

type EdgeName = 'left' | 'right' | 'top' | 'bottom'

interface Vec3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

function getVertex(vertices: Float32Array, index: number): Vec3 {
  //1.- Extract the xyz triplet stored in the packed buffer for vector math in assertions.
  return {
    x: vertices[index * 3],
    y: vertices[index * 3 + 1],
    z: vertices[index * 3 + 2],
  }
}

function vectorLength(vector: Vec3): number {
  //1.- Measure the magnitude directly to avoid pulling in heavyweight math utilities for tests.
  return Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z)
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  //1.- Compute directional offsets for edge walking heuristics.
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  }
}

function dot(a: Vec3, b: Vec3): number {
  //1.- Evaluate vector agreement for tangent alignment checks.
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function normalize(vector: Vec3): Vec3 {
  //1.- Return a unit vector while guarding against degenerate inputs.
  const length = vectorLength(vector)
  if (length === 0) {
    return vector
  }
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  }
}

function cross(a: Vec3, b: Vec3): Vec3 {
  //1.- Produce the orthogonal tangent used for directional traversal.
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function getEdge(face: readonly (readonly number[])[], edge: EdgeName): readonly number[] {
  //1.- Slice an ordered list of vertex indices for the requested face perimeter.
  const lastRow = face.length - 1
  const lastColumn = face[0].length - 1
  switch (edge) {
    case 'left':
      return face.map((row) => row[0])
    case 'right':
      return face.map((row) => row[lastColumn])
    case 'top':
      return face[lastRow]
    case 'bottom':
      return face[0]
  }
}

describe('generateCubedSphereMesh', () => {
  it('produces a unit-radius cubed sphere with shared seam vertices', () => {
    //1.- Build a moderately tessellated sphere to stress vertex deduplication along cube edges.
    const mesh = generateCubedSphereMesh(6)
    const uniqueKeys = new Set<string>()
    for (let index = 0; index < mesh.vertices.length / 3; index += 1) {
      const vertex = getVertex(mesh.vertices, index)
      //2.- Validate the vertex resides on the unit sphere and that seams are not double-booked.
      expect(vectorLength(vertex)).toBeCloseTo(1, 6)
      const key = `${vertex.x.toFixed(6)},${vertex.y.toFixed(6)},${vertex.z.toFixed(6)}`
      expect(uniqueKeys.has(key)).toBe(false)
      uniqueKeys.add(key)
    }
    expect(uniqueKeys.size).toBe(mesh.vertices.length / 3)
  })

  it('aligns edge strips across adjacent faces', () => {
    //1.- Generate the base mesh and catalogue every face perimeter run.
    const mesh = generateCubedSphereMesh(4)
    const edgeIndexMap = new Map<string, number[][]>()
    const edgeNames: EdgeName[] = ['left', 'right', 'top', 'bottom']
    mesh.faces.forEach((face) => {
      edgeNames.forEach((edgeName) => {
        const indices = [...getEdge(face.vertexIndices, edgeName)]
        const key = [...indices].sort((a, b) => a - b).join(',')
        const runs = edgeIndexMap.get(key)
        if (runs) {
          runs.push(indices)
        } else {
          edgeIndexMap.set(key, [indices])
        }
      })
    })
    //2.- Confirm every seam is owned by exactly two faces and they reference identical vertices.
    edgeIndexMap.forEach((runs) => {
      expect(runs.length).toBe(2)
      const [a, b] = runs
      const reversedB = [...b].reverse()
      const directMatch = a.every((value, index) => value === b[index])
      const reverseMatch = a.every((value, index) => value === reversedB[index])
      expect(directMatch || reverseMatch).toBe(true)
    })
  })

  it('supports great-circle traversal without deviating from the surface', () => {
    //1.- Assemble adjacency lists so the integration can hop between shared edge vertices.
    const mesh = generateCubedSphereMesh(8)
    const adjacency = new Map<number, Set<number>>()
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const a = mesh.indices[i]
      const b = mesh.indices[i + 1]
      const c = mesh.indices[i + 2]
      const triPairs: [number, number][] = [
        [a, b],
        [b, c],
        [c, a],
      ]
      triPairs.forEach(([from, to]) => {
        const list = adjacency.get(from)
        if (list) {
          list.add(to)
        } else {
          adjacency.set(from, new Set([to]))
        }
      })
      triPairs.forEach(([from, to]) => {
        const list = adjacency.get(to)
        if (list) {
          list.add(from)
        } else {
          adjacency.set(to, new Set([from]))
        }
      })
    }
    //2.- Pick a vertex on the equator and march along neighbours that best align with the tangent direction.
    let startIndex = 0
    let bestX = -Infinity
    for (let index = 0; index < mesh.vertices.length / 3; index += 1) {
      const vertex = getVertex(mesh.vertices, index)
      if (Math.abs(vertex.z) < 1e-6 && vertex.x > bestX) {
        bestX = vertex.x
        startIndex = index
      }
    }
    const axis: Vec3 = { x: 0, y: 0, z: 1 }
    const visited: number[] = []
    let currentIndex = startIndex
    let totalAngle = 0
    const maxSteps = mesh.subdivisions * 8
    for (let step = 0; step < maxSteps; step += 1) {
      visited.push(currentIndex)
      const current = getVertex(mesh.vertices, currentIndex)
      const tangent = normalize(cross(axis, current))
      let nextIndex: number | undefined
      let bestDot = -Infinity
      const neighbours = adjacency.get(currentIndex)
      if (!neighbours) {
        throw new Error('Great-circle traversal failed: missing adjacency data')
      }
      neighbours.forEach((candidate) => {
        const candidateVertex = getVertex(mesh.vertices, candidate)
        const offset = normalize(subtract(candidateVertex, current))
        const alignment = dot(offset, tangent)
        if (alignment > bestDot) {
          bestDot = alignment
          nextIndex = candidate
        }
      })
      if (nextIndex === undefined) {
        throw new Error('Great-circle traversal failed: unable to select a neighbour')
      }
      const next = getVertex(mesh.vertices, nextIndex)
      const angleDot = Math.max(-1, Math.min(1, dot(current, next)))
      totalAngle += Math.acos(angleDot)
      if (nextIndex === startIndex) {
        currentIndex = nextIndex
        break
      }
      currentIndex = nextIndex
    }
    //3.- Ensure the walker closed the loop, covered the full circumference, and never left the surface.
    expect(currentIndex).toBe(startIndex)
    expect(visited.length).toBeGreaterThan(0)
    visited.forEach((index) => {
      expect(vectorLength(getVertex(mesh.vertices, index))).toBeCloseTo(1, 6)
    })
    expect(totalAngle).toBeCloseTo(2 * Math.PI, 2)
  })
})

describe('createFixedCubedSphereLods', () => {
  it('builds unique, ordered LOD meshes shared across faces', () => {
    //1.- Request a trio of levels with duplicates to exercise ordering and deduplication logic.
    const lods = createFixedCubedSphereLods([2, 0, 1, 1])
    expect(lods.length).toBe(3)
    expect(lods[0].subdivisions).toBe(1)
    expect(lods[1].subdivisions).toBe(2)
    expect(lods[2].subdivisions).toBe(4)
    //2.- Confirm each mesh exposes face metadata for shared lookup and that buffers are immutable views.
    lods.forEach((mesh) => {
      expect(Object.isFrozen(mesh)).toBe(true)
      expect(mesh.faces.length).toBe(6)
    })
  })

  it('rejects empty LOD collections', () => {
    //1.- Safeguard against accidental empty arrays that would stall the streaming system.
    expect(() => createFixedCubedSphereLods([])).toThrow()
  })
})
