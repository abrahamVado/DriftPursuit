import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const resolveFromRoot = (relativePath: string) => path.resolve(__dirname, relativePath);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      //1.- Mirror the monorepo aliases so shared client modules resolve consistently.
      '@client': resolveFromRoot('../typescript-client/src'),
      '@web': resolveFromRoot('./src')
    }
  },
  build: {
    target: 'es2020'
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    alias: {
      //1.- Provide lightweight substitutes for heavy WebGL dependencies during unit tests.
      three: resolveFromRoot('test/mocks/three.ts'),
      '@client': resolveFromRoot('../typescript-client/src'),
      '@web': resolveFromRoot('./src')
    }
  }
});
