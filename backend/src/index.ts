import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings, Variables } from './types';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/user';
import { todoRoutes } from './routes/todos';
import { todoGroupRoutes } from './routes/todo-groups';
import { seedRoutes } from './routes/seeds';
import { scoreRoutes } from './routes/scores';
import { rankingRoutes } from './routes/rankings';
import { shareRoutes } from './routes/share';
import { dailyProgressRoutes } from './routes/daily-progress';
import { authMiddleware } from './middleware/auth';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// CORS
app.use('/api/*', cors({
  origin: (origin: string, c) => {
    const frontendUrl = (c.env as Record<string, string>).FRONTEND_URL;
    if (!frontendUrl || frontendUrl === '*') return '*';
    const allowed = frontendUrl.split(',').map((u: string) => u.trim());
    return allowed.includes(origin) ? origin : allowed[0];
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
app.route('/api/todos', todoRoutes);
app.route('/api/todo-groups', todoGroupRoutes);
app.route('/api/seeds', seedRoutes);
app.route('/api/scores', scoreRoutes);
app.route('/api/rankings', rankingRoutes);
app.route('/api/daily-progress', dailyProgressRoutes);

export default app;
