import path from "node:path";
import { defineConfig } from "vitest/config";

//1.- Configure Vitest to execute TypeScript unit tests under the node environment.
export default defineConfig({
  resolve: {
    alias: {
      //1.- Mirror the sandbox alias so networking tests can import the browser client without bundler context.
      "@web": path.resolve(__dirname, "../planet_sandbox_web/src"),
      //2.- Point the shared client alias back at this package for cross-package imports.
      "@client": path.resolve(__dirname, "src"),
    },
  },
  test: {
    //1.- Use the node environment so three.js can run without DOM APIs.
    environment: "node",
    //3.- Discover world and networking tests so snapshot/session utilities share a common runner.
    include: ["src/world/**/*.test.ts", "src/networking/**/*.test.ts"],
    //4.- Enable globals for consistency with other TypeScript tests in the project.
    globals: false,
  },
});
