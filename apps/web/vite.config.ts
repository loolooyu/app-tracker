import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.APPFOLIO_API ?? 'http://127.0.0.1:4317';

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    // The dev server proxies /api to the local API. The API only accepts the dev origin
    // (http://localhost:5173) when started with --dev; see docs/ARCHITECTURE.md.
    proxy: { '/api': { target: API, changeOrigin: true } },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
