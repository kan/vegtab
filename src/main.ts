import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import { i18n } from './ui/i18n';
import { initSound } from './ui/sound';
import { initAnim } from './ui/anim';
import { isChunkLoadError, reloadForStaleChunk } from './ui/lib/staleChunk';
import { isLegacyHost } from './ui/legacy/handoff';
import { startInstallOffer } from './ui/lib/install';
import './ui/theme.css';
import App from './App.vue';
import LegacyMovedApp from './ui/legacy/LegacyMovedApp.vue';

if (isLegacyHost()) {
  // The old URL shows only the moving notice (docs/SPEC.md §5.4)
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

  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', component: () => import('./ui/views/HomeView.vue') },
      { path: '/puzzle', component: () => import('./ui/views/PuzzleView.vue') },
      { path: '/puzzle/:seed', component: () => import('./ui/views/PuzzleView.vue') },
      { path: '/achievements', component: () => import('./ui/views/AchievementView.vue') },
      { path: '/replay/:scoreId', component: () => import('./ui/views/ReplayView.vue') },
      { path: '/s/:code', component: () => import('./ui/views/ShareRedirectView.vue') },
      // The tutorial hides the footer menu to give the board and its card the room (as TAKO-SEN)
      { path: '/tutorial', component: () => import('./ui/views/TutorialView.vue'), meta: { hideNav: true } },
      { path: '/about', component: () => import('./ui/views/AboutView.vue') },
      { path: '/licenses', component: () => import('./ui/views/LicensesView.vue') },
      // 鎖のモードの試作（#107）。開発時だけ。本番のビルドには入らない
      ...(import.meta.env.DEV
        ? [{ path: '/proto/lock', component: () => import('./ui/views/LockProtoView.vue'), meta: { hideNav: true } }]
        : []),
    ],
  });

  // 新しいデプロイで旧チャンクが消えていたら、読み込み直して新しいバンドルで開く（src/ui/lib/staleChunk.ts）。
  // 遷移の途中なら遷移先を開く。オフラインのときと、1 分のうちに読み込み直したときは何もしない
  let navigatingTo: string | null = null;
  router.beforeEach((to) => { navigatingTo = to.fullPath; });
  router.afterEach(() => { navigatingTo = null; });
  router.onError((error, to) => {
    if (isChunkLoadError(error)) reloadForStaleChunk(to.fullPath);
  });
  // router を通らない動的 import と、CSS や依存の preload の失敗。読み込み直すなら、エラーを投げさせない
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForStaleChunk(navigatingTo ?? location.href)) event.preventDefault();
  });

  const app = createApp(App);
  app.use(createPinia());
  app.use(i18n);
  app.use(router);
  app.mount('#app');
}
