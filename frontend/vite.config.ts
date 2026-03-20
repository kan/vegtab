import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@vegtab/engine': path.resolve(__dirname, '../engine/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    allowedHosts: true,
  },
});
