import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      //1.- Provide a lightweight stub for three.js so unit tests avoid heavy WebGL dependencies.
      three: path.resolve(__dirname, 'test/mocks/three.ts'),
      //2.- Mirror the monorepo client alias so Vitest matches Next.js module resolution.
      '@client': path.resolve(__dirname, '../typescript-client/src'),
      //3.- Align the web alias with Next.js so runtime modules resolve shared utilities.
      '@web': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    //1.- Target the networking mocks, procedural geometry, and UI interaction suites together with the remaining client tests.
    include: [
      'app/**/*.test.ts',
      'app/**/*.test.tsx',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'test/**/*.test.ts',
      'test/**/*.test.tsx',
    ],
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
  },
})
