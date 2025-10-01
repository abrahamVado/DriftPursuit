import type { SandboxParams } from "./config";
import { createDirectionState, stepDirection } from "./directionField";
import { mulberry32 } from "./prng";
import { createInitialFrame, transportFrame, type OrthonormalFrame } from "./frame";
import { add, normalize, scale, Vec3 } from "./vector";

export interface RingStation {
  index: number;
  position: Vec3;
  frame: OrthonormalFrame;
  radius: number;
  roughness: (theta: number) => number;
}

export interface ChunkData {
  chunkIndex: number;
  rings: RingStation[];
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  bbox: { min: Vec3; max: Vec3 };
}

interface GeneratorState {
  params: SandboxParams;
  directionState: ReturnType<typeof createDirectionState>;
  rand: () => number;
  ringIndex: number;
  position: Vec3;
  frame: OrthonormalFrame;
  nextChunkIndex: number;
}

export function createTerrainGenerator(params: SandboxParams): GeneratorState {
  const rand = mulberry32(params.worldSeed);
  const directionState = createDirectionState(params);
  const position: Vec3 = [0, 0, 0];
  const frame = createInitialFrame(directionState.forward);
  return { params, directionState, rand, ringIndex: 0, position, frame, nextChunkIndex: 0 };
}

function integrateRing(state: GeneratorState): RingStation {
  const { params, directionState, rand } = state;
  const sample = stepDirection(params, directionState, state.position, rand);
  const delta = scale(sample.forward, params.ringStep);
  state.position = add(state.position, delta);
  state.frame = transportFrame(state.frame, sample.forward);
  const station: RingStation = {
    index: state.ringIndex,
    position: state.position,
    frame: state.frame,
    radius: sample.radius,
    roughness: sample.roughness
  };
  state.ringIndex += 1;
  return station;
}

function computeBbox(points: number[]): { min: Vec3; max: Vec3 } {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i];
    const y = points[i + 1];
    const z = points[i + 2];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function buildRingVertices(ring: RingStation, params: SandboxParams): Vec3[] {
  const vertices: Vec3[] = [];
  const { frame } = ring;
  for (let i = 0; i < params.tubeSides; i += 1) {
    const theta = (i / params.tubeSides) * Math.PI * 2;
    const radius = ring.radius + ring.roughness(theta);
    const offset = add(scale(frame.right, Math.cos(theta) * radius), scale(frame.up, Math.sin(theta) * radius));
    vertices.push(add(ring.position, offset));
  }
  return vertices;
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function buildChunkGeometry(rings: RingStation[], params: SandboxParams) {
  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const ringVerts: Vec3[][] = rings.map((ring) => buildRingVertices(ring, params));
  for (let r = 0; r < ringVerts.length; r += 1) {
    const verts = ringVerts[r];
    for (let v = 0; v < verts.length; v += 1) {
      const p = verts[v];
      vertices.push(p[0], p[1], p[2]);
      const center = rings[r].position;
      const normal = normalize(subtract(p, center));
      normals.push(normal[0], normal[1], normal[2]);
    }
  }
  const stride = params.tubeSides;
  for (let r = 0; r < ringVerts.length - 1; r += 1) {
    for (let v = 0; v < stride; v += 1) {
      const nextV = (v + 1) % stride;
      const a = r * stride + v;
      const b = r * stride + nextV;
      const c = (r + 1) * stride + v;
      const d = (r + 1) * stride + nextV;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }
  const bbox = computeBbox(vertices);
  return {
    positions: new Float32Array(vertices),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    bbox
  };
}

export function generateNextChunk(state: GeneratorState): ChunkData {
  const { params, nextChunkIndex } = state;
  const rings: RingStation[] = [];
  const targetCount = Math.round(params.chunkLength / params.ringStep) + 1;
  for (let i = 0; i < targetCount; i += 1) {
    const ring = integrateRing(state);
    rings.push(ring);
  }
  const geometry = buildChunkGeometry(rings, params);
  const chunk: ChunkData = {
    chunkIndex: nextChunkIndex,
    rings,
    positions: geometry.positions,
    normals: geometry.normals,
    indices: geometry.indices,
    bbox: geometry.bbox
  };
  state.nextChunkIndex += 1;
  return chunk;
}
