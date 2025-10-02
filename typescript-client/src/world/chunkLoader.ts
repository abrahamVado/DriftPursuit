export interface Vector3 {
  x: number;
  y: number;
  z?: number;
}

export interface ChunkTransport {
  subscribe(chunk: number): void;
  unsubscribe(chunk: number): void;
}

export interface ArcChunkLoaderOptions {
  transport: ChunkTransport;
  arcDegrees?: number;
  radius?: number;
}

export const DEFAULT_ARC_DEGREES = 15;
export const DEFAULT_CHUNK_RADIUS = 3;

export class ArcChunkLoader {
  private readonly transport: ChunkTransport;
  private readonly arcRadians: number;
  private readonly chunkCount: number;
  private readonly radius: number;
  private readonly activeChunks = new Set<number>();
  private lastChunk: number | null = null;

  constructor(options: ArcChunkLoaderOptions) {
    if (!options || !options.transport) {
      throw new Error("transport is required");
    }
    //1.- Clamp the arc configuration so the loader never divides by zero.
    const arcDegrees = options.arcDegrees && options.arcDegrees > 0 && options.arcDegrees < 360 ? options.arcDegrees : DEFAULT_ARC_DEGREES;
    this.arcRadians = (arcDegrees * Math.PI) / 180;
    const chunks = Math.ceil((2 * Math.PI) / this.arcRadians);
    this.chunkCount = chunks > 0 ? chunks : 1;
    this.radius = options.radius !== undefined && options.radius >= 0 ? options.radius : DEFAULT_CHUNK_RADIUS;
    this.transport = options.transport;
  }

  update(position?: Vector3 | null): void {
    if (!position) {
      //1.- No position means we should relinquish every active subscription.
      this.flush();
      this.lastChunk = null;
      return;
    }

    const targetChunk = this.computeChunk(position);
    if (targetChunk < 0) {
      this.flush();
      this.lastChunk = null;
      return;
    }

    if (this.lastChunk !== null && this.lastChunk === targetChunk) {
      //2.- Avoid redundant work if the observer stayed within the same chunk.
      return;
    }

    const desired = this.computeRange(targetChunk);
    const desiredSet = new Set<number>(desired);

    //3.- Unsubscribe from stale chunks before subscribing to the new window.
    const toRemove = [...this.activeChunks].filter((chunk) => !desiredSet.has(chunk)).sort((a, b) => a - b);
    for (const chunk of toRemove) {
      this.transport.unsubscribe(chunk);
      this.activeChunks.delete(chunk);
    }

    //4.- Subscribe to any newly required chunks in ascending order for determinism.
    const toAdd = desired.filter((chunk) => !this.activeChunks.has(chunk)).sort((a, b) => a - b);
    for (const chunk of toAdd) {
      this.transport.subscribe(chunk);
      this.activeChunks.add(chunk);
    }

    this.lastChunk = targetChunk;
  }

  stop(): void {
    //1.- Explicit stop mirrors the behaviour of a null position update.
    this.flush();
    this.lastChunk = null;
  }

  private flush(): void {
    const pending = [...this.activeChunks].sort((a, b) => a - b);
    for (const chunk of pending) {
      this.transport.unsubscribe(chunk);
      this.activeChunks.delete(chunk);
    }
  }

  private computeChunk(position: Vector3): number {
    //1.- Use atan2 so positions in every quadrant map to a stable arc identifier.
    const angle = Math.atan2(position.y ?? 0, position.x ?? 0);
    let normalised = angle;
    if (normalised < 0) {
      normalised += 2 * Math.PI;
    }
    if (!isFinite(normalised)) {
      return -1;
    }
    const chunk = Math.floor(normalised / this.arcRadians);
    if (chunk < 0) {
      return -1;
    }
    return Math.min(chunk, this.chunkCount - 1);
  }

  private computeRange(center: number): number[] {
    if (center < 0 || this.chunkCount <= 0) {
      return [];
    }
    const range: number[] = [];
    const limit = this.radius >= 0 ? this.radius : 0;
    for (let offset = -limit; offset <= limit; offset += 1) {
      let chunk = (center + offset) % this.chunkCount;
      if (chunk < 0) {
        chunk += this.chunkCount;
      }
      range.push(chunk);
    }
    return range;
  }
}
