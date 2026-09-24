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
        theme_color: '#2e7d32',
        background_color: '#f5f0e8',
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
        // チュートリアルの画像（約 1.9MB）は初回訪問で precache せず、表示したときにキャッシュする。
        // ファイル名にハッシュがなく、同じ URL のまま撮り直すことがあるので、裏で取り直して更新する
        globIgnores: ['**/tutorial/**'],
        runtimeCaching: [
          {
            urlPattern: /\/tutorial\/[^/]+\.png$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'tutorial-images',
              expiration: { maxEntries: 20 },
            },
          },
        ],
        importScripts: ['/push-sw.js'],
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
  },
});
