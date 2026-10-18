// Site de présentation (landing) : page statique, déployable telle quelle sur Vercel (dossier site/dist).
// Réutilise la mascotte de l'app (src/features/mascot) : même dessin, mêmes animations.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: __dirname,
  base: '/',
  plugins: [react()],
  build: { outDir: path.join(__dirname, 'dist'), emptyOutDir: true, target: 'es2020' },
  server: { port: 5180, fs: { allow: [path.join(__dirname, '..')] } },
});
