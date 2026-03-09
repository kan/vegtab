import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Bindings, Variables } from '../types';

const updateProfileSchema = z.object({
  displayName: z.string().max(20).nullable(),
});

export const userRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// GET /api/user/profile
userRoutes.get('/profile', async (c) => {
  const userId = c.get('userId');

  const user = await c.env.DB.prepare(
    'SELECT id, display_name FROM users WHERE id = ?'
  ).bind(userId).first<{
    id: string;
    display_name: string | null;
  }>();

  if (!user) return c.json({ error: 'User not found' }, 404);

  return c.json({
    id: user.id,
    displayName: user.display_name,
  });
});

// PATCH /api/user/profile
userRoutes.patch('/profile', zValidator('json', updateProfileSchema), async (c) => {
  const userId = c.get('userId');
  const { displayName } = c.req.valid('json');

  await c.env.DB.prepare(
    'UPDATE users SET display_name = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(displayName, userId).run();

  return c.json({ success: true });
});
