// Minimal ambient typings for the Buf "wire" subpath so TS can type-check.
// Runtime comes from node_modules/@bufbuild/protobuf; this file is types only.
declare module '@bufbuild/protobuf/wire' {
  export class BinaryReader {
    constructor(bytes: Uint8Array);
    pos: number;
    len: number;
    uint32(): number;
    int32(): number;
    int64(): bigint;
    uint64(): bigint;
    double(): number;
    float(): number;
    bool(): boolean;
    string(): string;
    bytes(): Uint8Array;
    skip(wireType: number): void;
  }

  export class BinaryWriter {
    uint32(value: number): BinaryWriter;
    int32(value: number): BinaryWriter;
    int64(value: bigint | number | string): BinaryWriter;
    uint64(value: bigint | number | string): BinaryWriter;
    double(value: number): BinaryWriter;
    float(value: number): BinaryWriter;
    bool(value: boolean): BinaryWriter;
    string(value: string): BinaryWriter;
    bytes(value: Uint8Array): BinaryWriter;

    // Buf writer pattern: fork() ... encode submessage ... join()
    fork(): BinaryWriter;
    join(): BinaryWriter;

    // Some generators still emit ldelim(); harmless to keep.
    ldelim(): BinaryWriter;

    finish(): Uint8Array;
  }
}
