import { describe, expect, it } from 'vitest';
import { BinaryWriter } from '@bufbuild/protobuf/wire';

//1.- Ensure the shimmed module resolution yields the expected class exported by the protobuf wire helpers.
describe('protobuf wire module declaration', () => {
  //2.- Verify that importing BinaryWriter produces a usable constructor at runtime and during type-checking.
  it('exposes the BinaryWriter constructor', () => {
    //3.- Instantiate the writer and assert the instance matches the exported type, confirming the shim behaves correctly.
    const writer = new BinaryWriter();
    expect(writer).toBeInstanceOf(BinaryWriter);
  });
});
