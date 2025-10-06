import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: [],
    globals: true
  },
  resolve: {
    //1.- Mirror the Next.js path aliases so Vitest can resolve shared modules.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});
