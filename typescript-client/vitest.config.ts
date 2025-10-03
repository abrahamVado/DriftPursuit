import { defineConfig } from "vitest/config";

//1.- Configure Vitest to execute TypeScript unit tests under the node environment.
export default defineConfig({
  test: {
    //1.- Use the node environment so three.js can run without DOM APIs.
    environment: "node",
    //2.- Limit discovery to procedural geometry tests to avoid executing legacy harness files.
    include: ["src/world/procedural/**/*.test.ts"],
    //3.- Enable globals for consistency with other TypeScript tests in the project.
    globals: false,
  },
});
