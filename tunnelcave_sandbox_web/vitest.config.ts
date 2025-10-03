import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      //1.- Provide a lightweight stub for three.js so unit tests avoid heavy WebGL dependencies.
      three: path.resolve(__dirname, 'test/mocks/three.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
  },
})
