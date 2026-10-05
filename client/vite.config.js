import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend the dev server forwards API and live-socket traffic to
const API = 'http://localhost:5100';

export default defineConfig({
  plugins: [react()],
  server: {
    // start-dev.ps1 / stop-dev.ps1 expect the dashboard on port 3000
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': API,
      '/health': API,
      '/socket.io': { target: API, ws: true },
    },
  },
  build: {
    // The backend serves this folder in production (plan task 2.2)
    outDir: 'build',
    emptyOutDir: true,
  },
});
