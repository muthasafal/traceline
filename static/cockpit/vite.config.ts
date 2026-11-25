import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Forge Custom UI serves the build folder from a relative base inside an iframe.
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  build: { outDir: 'build', emptyOutDir: true, sourcemap: false },
});
