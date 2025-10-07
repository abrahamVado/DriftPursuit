import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

//1.- Align Vitest's module resolution with the tsconfig alias while registering both HUD and weapon regression suites.
const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(rootDir, 'game/src')
    }
  },
  test: {
    include: [
      'game/src/__tests__/remotePlayers.test.ts',
      'game/src/__tests__/minimap.test.tsx',
      'game/src/weapons/__tests__/**/*.test.ts'
    ],
    environment: 'node',
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['game/src/engine/remotePlayers.ts']
    }
  }
})
