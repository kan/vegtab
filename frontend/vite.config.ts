import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Vege-Table',
        short_name: 'VegeTab',
        description: 'Daily 3-match puzzle game',
        theme_color: '#fff7ec',
        background_color: '#fff7ec',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        importScripts: ['/push-sw.js'],
        // The Worker answers these, not the SPA: share pages (OGP, and the old host's redirect to
        // the new URL) and the API
        navigateFallbackDenylist: [/^\/s\//, /^\/api\//],
        // API の応答はキャッシュしない。/api/* はすべて認証付きでユーザーごとに内容が変わる（ランキングも
        // 自分の順位を含む）のに、キャッシュキーに Authorization が入らず、引き継ぎ後に旧アカウントの応答が返っていた
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@vegtab/engine': path.resolve(__dirname, '../engine/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    allowedHosts: true,
    // The API is same-origin (the kan-game.app ID cookie goes only with it): the backend's
    // `wrangler dev` answers /api and the share pages. scripts/dev.mjs starts it on 127.0.0.1 on a
    // free port and names it here. Origin is passed as it is, so the API sees this page's origin
    // (ALLOWED_ORIGINS)
    proxy: {
      '/api': `http://127.0.0.1:${process.env.VEGTAB_API_PORT || 8788}`,
      '/s/': `http://127.0.0.1:${process.env.VEGTAB_API_PORT || 8788}`,
    },
  },
});
