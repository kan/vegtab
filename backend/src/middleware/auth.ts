import { createMiddleware } from 'hono/factory';
import type { Bindings, Variables } from '../types';
import { verifyToken } from '../lib/jwt';

export const authMiddleware = createMiddleware<{
  Bindings: Bindings;
  Variables: Variables;
}>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice(7);
  const userId = await verifyToken(token, c.env.JWT_SECRET, 'access');
  if (!userId) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  c.set('userId', userId);
  await next();
});
