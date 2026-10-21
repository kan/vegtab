import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import { i18n } from './i18n';
import { initSound } from './sound';
import { initAnim } from './anim';
import { reloadOnChunkLoadError, clearChunkReloadMark } from './lib/chunkReload';
import { isLegacyHost } from './legacy/handoff';
import './theme.css';
import App from './App.vue';
import LegacyMovedApp from './legacy/LegacyMovedApp.vue';

if (isLegacyHost()) {
  // The old URL shows only the moving notice (docs/SPEC.md §5.4)
  createApp(LegacyMovedApp).use(i18n).mount('#app');
} else {
  startGame();
}

function startGame() {
  initSound();
  initAnim();

  // 旧版の Service Worker が認証付きの API 応答をユーザーに関係なくキャッシュしていた。今は使わないので消す
  if ('caches' in window) caches.delete('api-cache').catch(() => {});

  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', component: () => import('./views/HomeView.vue') },
      { path: '/puzzle', component: () => import('./views/PuzzleView.vue') },
      { path: '/puzzle/:seed', component: () => import('./views/PuzzleView.vue') },
      { path: '/achievements', component: () => import('./views/AchievementView.vue') },
      { path: '/replay/:scoreId', component: () => import('./views/ReplayView.vue') },
      { path: '/s/:code', component: () => import('./views/ShareRedirectView.vue') },
      { path: '/tutorial', component: () => import('./views/TutorialView.vue') },
      { path: '/about', component: () => import('./views/AboutView.vue') },
    ],
  });

  // 新しいデプロイで旧チャンクが消えていたら、遷移先を読み込み直して新しいバンドルで開く。
  // オフラインでも同じエラーになるが、そのときは読み込み直してもアプリの状態を失うだけなので何もしない
  router.onError((error, to) => {
    if (!navigator.onLine) return;
    reloadOnChunkLoadError(error, to.fullPath);
  });
  router.afterEach(clearChunkReloadMark);

  const app = createApp(App);
  app.use(createPinia());
  app.use(i18n);
  app.use(router);
  app.mount('#app');
}
