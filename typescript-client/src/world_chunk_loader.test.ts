import assert from "assert";
import { ArcChunkLoader, ChunkTransport } from "./world/chunkLoader";

class StubTransport implements ChunkTransport {
  public subscribed: number[] = [];
  public unsubscribed: number[] = [];

  subscribe(chunk: number): void {
    this.subscribed.push(chunk);
  }

  unsubscribe(chunk: number): void {
    this.unsubscribed.push(chunk);
  }

  reset(): void {
    this.subscribed = [];
    this.unsubscribed = [];
  }
}

function main(): void {
  const transport = new StubTransport();
  const loader = new ArcChunkLoader({ transport, arcDegrees: 45, radius: 3 });

  //1.- Initial update should subscribe to the observer chunk and its ±3 neighbours.
  loader.update({ x: 1, y: 0 });
  assert.deepStrictEqual(transport.subscribed, [0, 1, 2, 3, 5, 6, 7]);
  assert.deepStrictEqual(transport.unsubscribed, []);

  //2.- Moving into the northern quadrant should shed chunk 6 and load chunk 4.
  transport.reset();
  loader.update({ x: 0, y: 1 });
  assert.deepStrictEqual(transport.unsubscribed, [6]);
  assert.deepStrictEqual(transport.subscribed, [4]);

  //3.- Clearing the position should unsubscribe from every remaining chunk.
  transport.reset();
  loader.update(null);
  assert.deepStrictEqual(transport.subscribed, []);
  assert.deepStrictEqual(transport.unsubscribed, [0, 1, 2, 3, 4, 5, 7]);
}

main();
