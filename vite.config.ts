import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', target: 'chrome120', chunkSizeWarningLimit: 4000 },
  server: { port: 5173 },
  // Décodeurs HEIC / TIFF du worker de conversion (src/features/reader/image/convert.worker.ts) :
  // pré-optimisés au démarrage du serveur de développement, sinon leur découverte tardive recharge la page.
  optimizeDeps: { include: ['heic-decode/lib.js', 'utif', 'libheif-js/libheif-wasm/libheif-bundle.mjs', 'nspell', 'diff', 'marked', 'dompurify'] },
});
