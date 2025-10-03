import { defineConfig } from "vitest/config";

//1.- Configure Vitest to execute TypeScript unit tests under the node environment.
export default defineConfig({
  test: {
    //1.- Use the node environment so three.js can run without DOM APIs.
    environment: "node",
    //2.- Discover all world scoped tests so shared event utilities run alongside scene manager coverage.
    include: ["src/world/**/*.test.ts"],
    //3.- Enable globals for consistency with other TypeScript tests in the project.
    globals: false,
  },
});
