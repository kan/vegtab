import { Hono } from 'hono';
import type { Bindings, Variables } from './types';
import { getBaseUrl, isLegacyHost } from './lib/env';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/user';
import { seedRoutes } from './routes/seeds';
import { scoreRoutes } from './routes/scores';
import { rankingRoutes } from './routes/rankings';
import { achievementRoutes } from './routes/achievements';
import { pushRoutes } from './routes/push';
import { shareRoutes } from './routes/share';
import { legacyClaimRoutes, legacyHandoffRoutes } from './routes/legacy';
import { authMiddleware } from './middleware/auth';
import { sendDailyPushNotifications } from './lib/push-cron';
import { purgeExpiredRefreshTokens } from './lib/refresh-tokens';
import { sweepDeletedAccounts } from './lib/account';

export { GameService } from './game-service';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// The old host (vegtab.app) only hands its accounts over (docs/SPEC.md §5.4). Its screen is the same
// SPA, which shows the moving notice there. Share URLs go to the new host as they are
const LEGACY_API = ['/api/health', '/api/auth/refresh', '/api/legacy/handoff'];
app.use('*', async (c, next) => {
  if (!isLegacyHost(c.env, c.req.url)) return next();
  const url = new URL(c.req.url);
  if (url.pathname.startsWith('/s/')) {
    return c.redirect(`${getBaseUrl(c.env)}${url.pathname}${url.search}`, 301);
  }
  if (!LEGACY_API.includes(url.pathname)) {
    return c.json({ error: 'moved', url: getBaseUrl(c.env) }, 410);
  }
  return next();
});

// The ID API of kan-game.app, served as if from this origin (kan/game docs/ID_DESIGN.md「HTTP の API」).
// The request goes on unchanged: the platform limits requests by CF-Connecting-IP and checks Origin itself
app.all('/api/id/*', async (c) => {
  try {
    return await c.env.ID.fetch(c.req.raw);
  } catch (error) {
    console.error(JSON.stringify({ event: 'id_proxy_failure', error: String(error) }));
    return c.json({ error: 'service_unavailable' }, 503);
  }
});

// Public routes
app.route('/api/auth', authRoutes);
app.route('/api/legacy', legacyHandoffRoutes);
app.route('/s', shareRoutes);

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok' }));

// Protected routes (require the kan-game.app ID cookie)
app.use('/api/*', authMiddleware);
app.route('/api/user', userRoutes);
app.route('/api/legacy', legacyClaimRoutes);
app.route('/api/seeds', seedRoutes);
app.route('/api/scores', scoreRoutes);
app.route('/api/rankings', rankingRoutes);
app.route('/api/achievements', achievementRoutes);
app.route('/api/push', pushRoutes);

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(sendDailyPushNotifications(env));
    ctx.waitUntil(purgeExpiredRefreshTokens(env.DB));
    ctx.waitUntil(sweepDeletedAccounts(env));
  },
};
