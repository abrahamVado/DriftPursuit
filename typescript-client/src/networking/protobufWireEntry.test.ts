import { describe, expect, it } from 'vitest';
import { BinaryReader, BinaryWriter } from '@bufbuild/protobuf/wire';

//1.- Verify the protobuf wire entrypoint remains constructible when TypeScript uses package export resolution.
describe('protobuf wire entrypoint', () => {
  it('instantiates the canonical reader and writer implementations', () => {
    const reader = new BinaryReader(new Uint8Array());
    const writer = new BinaryWriter();

    expect(reader).toBeInstanceOf(BinaryReader);
    expect(typeof writer.finish).toBe('function');
  });
});
