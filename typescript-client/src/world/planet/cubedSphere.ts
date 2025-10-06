import type { PlanetSpec } from "./planetSpec";

export type CubeFace = 0 | 1 | 2 | 3 | 4 | 5;

export interface CubeTileKey {
  //1.- Identify the quadtree location for streaming and scatter keys.
  face: CubeFace;
  //2.- Horizontal tile coordinate inside the quadtree level.
  i: number;
  //3.- Vertical tile coordinate inside the quadtree level.
  j: number;
  //4.- Level-of-detail depth where 0 represents the root face.
  lod: number;
}

export interface CubeTileMesh {
  //1.- Unique key referencing the tile for caching and streaming.
  key: CubeTileKey;
  //2.- Ordered list of vertex positions in planet-fixed coordinates.
  vertices: Array<{ x: number; y: number; z: number }>;
  //3.- Triangle indices forming an edge-aligned tessellation.
  indices: number[];
}

function projectToSphere(u: number, v: number, face: CubeFace, radius: number): {
  x: number;
  y: number;
  z: number;
} {
  //1.- Convert a face-local coordinate into 3D space using the cubed-sphere projection.
  const a = 2 * u - 1;
  const b = 2 * v - 1;
  let x = 0;
  let y = 0;
  let z = 0;
  switch (face) {
    case 0:
      x = 1;
      y = a;
      z = b;
      break;
    case 1:
      x = -1;
      y = -a;
      z = b;
      break;
    case 2:
      x = -a;
      y = 1;
      z = b;
      break;
    case 3:
      x = a;
      y = -1;
      z = b;
      break;
    case 4:
      x = a;
      y = b;
      z = 1;
      break;
    case 5:
    default:
      x = a;
      y = -b;
      z = -1;
      break;
  }
  const normalised = 1 / Math.hypot(x, y, z);
  return { x: x * normalised * radius, y: y * normalised * radius, z: z * normalised * radius };
}

function tileResolution(lod: number): number {
  //1.- Each successive level doubles resolution ensuring shared vertices along edges.
  return (1 << lod) + 1;
}

function generateIndices(resolution: number): number[] {
  //1.- Build triangle strips aligned across edges for consistent tessellation between tiles.
  const indices: number[] = [];
  for (let y = 0; y < resolution - 1; y += 1) {
    for (let x = 0; x < resolution - 1; x += 1) {
      const topLeft = y * resolution + x;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + resolution;
      const bottomRight = bottomLeft + 1;
      indices.push(topLeft, bottomLeft, topRight);
      indices.push(topRight, bottomLeft, bottomRight);
    }
  }
  return indices;
}

export function buildCubeTileMesh(spec: PlanetSpec, key: CubeTileKey): CubeTileMesh {
  //1.- Determine the resolution for this level of detail.
  const resolution = tileResolution(key.lod);
  const step = 1 / (resolution - 1);
  const vertices: Array<{ x: number; y: number; z: number }> = [];
  for (let y = 0; y < resolution; y += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const u = (key.i + x * step) / (1 << key.lod);
      const v = (key.j + y * step) / (1 << key.lod);
      const projected = projectToSphere(u, v, key.face, spec.radius);
      vertices.push(projected);
    }
  }
  //2.- Calculate triangle indices ensuring edge consistency.
  const indices = generateIndices(resolution);
  return { key, vertices, indices };
}

export function enumerateCircumnavigation(spec: PlanetSpec, samples: number): number {
  //1.- Trace a ring along the equator across the four lateral cube faces.
  const segmentsPerFace = Math.max(1, samples);
  const points: Array<{ x: number; y: number; z: number }> = [];
  const faceOrder: CubeTileKey["face"][] = [0, 2, 1, 3];
  for (const face of faceOrder) {
    for (let stepIndex = 0; stepIndex <= segmentsPerFace; stepIndex += 1) {
      if (points.length > 0 && stepIndex === 0) {
        continue;
      }
      const u = stepIndex / segmentsPerFace;
      const v = 0.5;
      points.push(projectToSphere(u, v, face, spec.radius));
    }
  }
  if (points.length === 0) {
    return 0;
  }
  points.push(points[0]);
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    total += Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }
  return total;
}
