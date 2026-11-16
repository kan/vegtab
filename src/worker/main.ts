import type { Bindings } from './types';
import { matchRoute, type AccountRequest, type Route } from './router';
import { getBaseUrl, isLegacyHost } from './lib/env';
import { json, redirect, text, withSecurityHeaders } from './lib/http';
import { requireAccount } from './lib/id-auth';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/user';
import { seedRoutes } from './routes/seeds';
import { scoreRoutes } from './routes/scores';
import { rankingRoutes } from './routes/rankings';
import { achievementRoutes } from './routes/achievements';
import { pushRoutes } from './routes/push';
import { shareRoutes } from './routes/share';
import { legacyClaimRoutes, legacyHandoffRoutes } from './routes/legacy';
import { sendDailyPushNotifications } from './lib/push-cron';
import { purgeExpiredRefreshTokens } from './lib/refresh-tokens';
import { sweepDeletedAccounts } from './lib/account';
import { purgeStaleRateLimits } from './lib/rate-limit';

export { GameService } from './game-service';

/** Routes open to anyone */
const PUBLIC_ROUTES: Route[] = [
  ...authRoutes,
  ...legacyHandoffRoutes,
  ...shareRoutes,
  { method: 'GET', path: '/api/health', handler: () => json({ status: 'ok' }) },
];

/** Routes that need the kan-game.app ID cookie (lib/id-auth.ts requireAccount) */
const ACCOUNT_ROUTES: Route<AccountRequest>[] = [
  ...userRoutes,
  ...legacyClaimRoutes,
  ...seedRoutes,
  ...scoreRoutes,
  ...rankingRoutes,
  ...achievementRoutes,
  ...pushRoutes,
];

// The old host (vegtab.app) only hands its accounts over (docs/DATA_CONTRACT.md「旧 URL からの引き継ぎ」). Its screen is the same
// SPA, which shows the moving notice there. Share URLs go to the new host as they are
const LEGACY_API = ['/api/health', '/api/auth/refresh', '/api/legacy/handoff'];

async function handle(request: Request, env: Bindings, url: URL): Promise<Response> {
  if (isLegacyHost(env, request.url)) {
    if (url.pathname.startsWith('/s/')) {
      return redirect(`${getBaseUrl(env)}${url.pathname}${url.search}`, 301);
    }
    if (!LEGACY_API.includes(url.pathname)) {
      return json({ error: 'moved', url: getBaseUrl(env) }, 410);
    }
  }

  // The ID API of kan-game.app, served as if from this origin (kan/game docs/ID_DESIGN.md「HTTP の API」).
  // The request goes on unchanged: the platform limits requests by CF-Connecting-IP and checks Origin itself
  if (url.pathname === '/api/id' || url.pathname.startsWith('/api/id/')) {
    try {
      return await env.ID.fetch(request);
    } catch (error) {
      console.error(JSON.stringify({ event: 'id_proxy_failure', error: String(error) }));
      return json({ error: 'service_unavailable' }, 503);
    }
  }

  const open = matchRoute(PUBLIC_ROUTES, request.method, url.pathname);
  if (open) return open.route.handler({ request, env, url, params: open.params });
  if (!url.pathname.startsWith('/api/')) return text('Not found', 404);

  // Every other API needs the ID, even one that does not exist (as before: the check came first)
  const account = await requireAccount(request, env);
  if (account instanceof Response) return account;
  const matched = matchRoute(ACCOUNT_ROUTES, request.method, url.pathname);
  if (!matched) return json({ error: 'not_found' }, 404);
  return matched.route.handler({ request, env, url, params: matched.params, accountId: account.accountId });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    let response: Response;
    try {
      response = await handle(request, env, url);
    } catch (error) {
      // An exception is logged and answered with a code, like the other errors
      console.error(JSON.stringify({
        event: 'unhandled_error', method: request.method, path: url.pathname,
        error: String(error), stack: error instanceof Error ? error.stack : undefined,
      }));
      response = json({ error: 'internal_error' }, 500);
    }
    // HEAD is answered as GET (router.ts), without the body
    if (request.method === 'HEAD') response = new Response(null, response);
    return withSecurityHeaders(response, url, env.ENVIRONMENT);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sendDailyPushNotifications(env));
    ctx.waitUntil(purgeExpiredRefreshTokens(env.DB));
    ctx.waitUntil(sweepDeletedAccounts(env));
    ctx.waitUntil(purgeStaleRateLimits(env.DB));
  },
} satisfies ExportedHandler<Bindings>;
