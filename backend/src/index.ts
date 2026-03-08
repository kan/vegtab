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
  origin: '*',
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
