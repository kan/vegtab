import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Bindings, Variables } from '../types';

/** Control characters and bidi overrides/isolates that can break or spoof how names render */
const FORBIDDEN_NAME_CHARS = /[\p{Cc}\u{202A}-\u{202E}\u{2066}-\u{2069}]/u;

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(20)
    .refine((name) => !FORBIDDEN_NAME_CHARS.test(name), 'Invalid characters')
    .nullable(),
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
