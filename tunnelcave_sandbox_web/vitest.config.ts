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
    //1.- Target the networking mocks, procedural geometry, and UI interaction suites together with the remaining client tests.
    include: [
      'app/**/*.test.ts',
      'src/**/*.test.ts',
      'test/**/*.test.ts',
    ],
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
  },
})
