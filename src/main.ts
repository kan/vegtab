import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import { i18n } from './ui/i18n';
import { initSound } from './ui/sound';
import { initAnim } from './ui/anim';
import { reloadOnChunkLoadError, clearChunkReloadMark } from './ui/lib/chunkReload';
import { isLegacyHost } from './ui/legacy/handoff';
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
