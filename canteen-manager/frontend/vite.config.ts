/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      // The backend serves routes at root (no global prefix); the client uses a
      // `/api` base so production can be reverse-proxied behind one path. Strip
      // the prefix here so dev requests hit the real root-level routes.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    // Serialize file execution so the vitest-axe singleton never runs concurrently
    // across test files. The suite is small (~118 tests) so the throughput cost is
    // negligible; flaky "Axe is already running" races under cold-load are eliminated.
    fileParallelism: false,
    // Cold-load CPU contention (especially on M-series) can starve userEvent
    // timers in keyboard tests; 15 s gives enough headroom without being unsafe.
    testTimeout: 15000,
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
  },
});
