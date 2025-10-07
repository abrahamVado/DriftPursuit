import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

//1.- Align Vitest's module resolution with the tsconfig alias and scope coverage to the new remote player logic.
const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(rootDir, 'game/src')
    }
  },
  test: {
    include: ['game/src/__tests__/remotePlayers.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['game/src/engine/remotePlayers.ts']
    }
  }
})
