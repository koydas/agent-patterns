import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import content from './scripts/content-plugin.mjs';

// Project page: https://koydas.github.io/agent-patterns/ — every route is served under this base.
export default defineConfig({
  base: '/agent-patterns/',
  plugins: [react(), content()],
  server: { port: 5173, fs: { allow: ['..'] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 400 },
  test: {
    environment: 'happy-dom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    alias: { '@anthropic-ai/sdk': new URL('./src/test/sdk-stub.ts', import.meta.url).pathname },
  },
});
