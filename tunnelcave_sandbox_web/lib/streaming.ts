import type { SandboxParams } from "./config";
import { createTerrainGenerator, generateNextChunk, type ChunkData } from "./terrain";

export interface ChunkBand {
  chunks: Map<number, ChunkData>;
  generatorState: ReturnType<typeof createTerrainGenerator>;
}

export function createChunkBand(params: SandboxParams): ChunkBand {
  return {
    chunks: new Map(),
    generatorState: createTerrainGenerator(params)
  };
}

export function ensureChunks(band: ChunkBand, centerChunk: number, keepBefore = 2, keepAfter = 3) {
  const min = Math.max(0, centerChunk - keepBefore);
  const max = centerChunk + keepAfter;
  const { generatorState } = band;
  while (generatorState.nextChunkIndex <= max) {
    const chunk = generateNextChunk(generatorState);
    band.chunks.set(chunk.chunkIndex, chunk);
  }
  for (const key of [...band.chunks.keys()]) {
    if (key < min || key > max) {
      band.chunks.delete(key);
    }
  }
}
