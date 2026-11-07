import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The React app lives in /client. `npm run build` puts the finished site in /dist,
// which the Express server (server/index.js) then serves.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
