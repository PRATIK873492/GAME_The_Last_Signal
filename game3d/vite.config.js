import { defineConfig } from 'vite';

// Relative base so the built game (dist/) works from any folder or host.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 3000 },
});
