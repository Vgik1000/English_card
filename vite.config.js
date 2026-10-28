import { defineConfig } from 'vite';
import { offlinePlugin } from './scripts/offline-build.js';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [offlinePlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          excel: ['exceljs'],
        },
      },
    },
  },
});
