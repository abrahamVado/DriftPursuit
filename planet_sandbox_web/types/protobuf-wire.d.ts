//1.- Provide a module declaration so the TypeScript compiler can resolve the wire helpers during type-checking.
declare module "@bufbuild/protobuf/wire" {
  //2.- Re-export the generated ESM wire entry which mirrors the runtime export structure shipped by the package.
  export * from "@bufbuild/protobuf/dist/esm/wire/index.js";
}
