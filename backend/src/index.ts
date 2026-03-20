import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings, Variables } from './types';
import { getAllowedOrigins } from './lib/env';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/user';
import { seedRoutes } from './routes/seeds';
import { scoreRoutes } from './routes/scores';
import { rankingRoutes } from './routes/rankings';
import { achievementRoutes } from './routes/achievements';
import { pushRoutes } from './routes/push';
import { shareRoutes } from './routes/share';
import { authMiddleware } from './middleware/auth';
import { sendDailyPushNotifications } from './lib/push-cron';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// CORS
app.use('/api/*', cors({
  origin: (origin: string, c) => {
    const allowed = getAllowedOrigins(c.env as Bindings);
    if (!allowed) return '*';
    return allowed.includes(origin) ? origin : '';
  },
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Public routes
app.route('/api/auth', authRoutes);
app.route('/s', shareRoutes);

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok' }));

// Protected routes (require JWT)
app.use('/api/*', authMiddleware);
app.route('/api/user', userRoutes);
app.route('/api/seeds', seedRoutes);
app.route('/api/scores', scoreRoutes);
app.route('/api/rankings', rankingRoutes);
app.route('/api/achievements', achievementRoutes);
app.route('/api/push', pushRoutes);

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(sendDailyPushNotifications(env));
  },
};
