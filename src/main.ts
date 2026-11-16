import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { i18n } from './ui/i18n';
import { initSound } from './ui/sound';
import { initAnim } from './ui/anim';
import { reloadForStaleChunk } from './ui/lib/staleChunk';
import { isLegacyHost } from './ui/legacy/handoff';
import { startInstallOffer } from './ui/lib/install';
import { router } from './ui/routes';
import './ui/theme.css';
import App from './App.vue';
import LegacyMovedApp from './ui/legacy/LegacyMovedApp.vue';

if (isLegacyHost()) {
  // The old URL shows only the moving notice (docs/DATA_CONTRACT.md「旧 URL からの引き継ぎ」)
  createApp(LegacyMovedApp).use(i18n).mount('#app');
} else {
  startGame();
}

function startGame() {
  // Before mounting: the browser's install prompt may come before the screens are up
  startInstallOffer();
  initSound();
  initAnim();

  // 旧版の Service Worker が認証付きの API 応答をユーザーに関係なくキャッシュしていた。今は使わないので消す
  if ('caches' in window) caches.delete('api-cache').catch(() => {});

  // 画面の遅延 import の失敗は router が読み込み直す（src/ui/routes.ts）。こちらは router を通らない動的
  // import と、CSS や依存の preload の失敗。遷移の途中なら遷移先を開く。読み込み直すなら、エラーを投げさせない
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForStaleChunk(router.pendingPath() ?? location.href)) event.preventDefault();
  });

  const app = createApp(App);
  app.use(createPinia());
  app.use(i18n);
  // The first screen is mounted when its chunk has loaded (src/ui/lib/router.ts)
  void router.start();
  app.mount('#app');
}
