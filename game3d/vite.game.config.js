import { defineConfig } from 'vite';

// Builds the 3D engine for the FULL game into web/engine/engine.js.
// web/index.html loads it as a module on top of the game scripts.
export default defineConfig({
  base: './',
  build: {
    outDir: '../web/engine', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: 'src/web3d/engine.js',
      preserveEntrySignatures: 'strict',
      output: { format: 'es', entryFileNames: 'engine.js', chunkFileNames: '[name].js', assetFileNames: '[name][extname]' },
    },
  },
});
