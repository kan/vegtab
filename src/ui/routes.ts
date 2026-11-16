import { createRouter, type RouteDef, type RouteState, type Router } from './lib/router';
import { isChunkLoadError, reloadForStaleChunk } from './lib/staleChunk';

/** The screens and their URLs (lib/router.ts) */
const ROUTES: RouteDef[] = [
  { path: '/', load: () => import('./views/HomeView.vue') },
  { path: '/puzzle', load: () => import('./views/PuzzleView.vue') },
  { path: '/puzzle/:seed', load: () => import('./views/PuzzleView.vue') },
  { path: '/achievements', load: () => import('./views/AchievementView.vue') },
  { path: '/replay/:scoreId', load: () => import('./views/ReplayView.vue') },
  { path: '/s/:code', load: () => import('./views/ShareRedirectView.vue') },
  // The tutorial hides the footer menu to give the board and its card the room (as TAKO-SEN)
  { path: '/tutorial', load: () => import('./views/TutorialView.vue'), meta: { hideNav: true } },
  { path: '/about', load: () => import('./views/AboutView.vue') },
  { path: '/licenses', load: () => import('./views/LicensesView.vue') },
  // 鎖のモードの試作（#107）。開発時だけ。本番のビルドには入らない
  ...(import.meta.env.DEV
    ? [{ path: '/proto/lock', load: () => import('./views/LockProtoView.vue'), meta: { hideNav: true } }]
    : []),
];

/**
 * 新しいデプロイで旧チャンクが消えていたら、読み込み直して新しいバンドルで開く（lib/staleChunk.ts）。
 * 遷移の途中なら遷移先を開く。オフラインのときと、1 分のうちに読み込み直したときは何もしない
 */
export const router: Router = createRouter(ROUTES, window, (error, fullPath) => {
  if (isChunkLoadError(error)) reloadForStaleChunk(fullPath);
  else console.error(error);
});

/** The current route (reactive), as vue-router's useRoute */
export function useRoute(): RouteState {
  return router.route;
}

/** push / replace / back, as vue-router's useRouter */
export function useRouter(): Router {
  return router;
}
