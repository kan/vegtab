import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Bindings, Variables } from '../types';
import { generateId } from '../lib/id';

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

export const pushRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// POST /api/push/subscribe — Register or update a push subscription
pushRoutes.post('/subscribe', zValidator('json', subscribeSchema), async (c) => {
  const userId = c.get('userId');
  const { endpoint, keys } = c.req.valid('json');

  await c.env.DB.prepare(`
    INSERT INTO push_subscriptions (id, user_id, endpoint, key_p256dh, key_auth)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (endpoint) DO UPDATE SET
      user_id = excluded.user_id,
      key_p256dh = excluded.key_p256dh,
      key_auth = excluded.key_auth
  `).bind(generateId(), userId, endpoint, keys.p256dh, keys.auth).run();

  return c.json({ ok: true });
});

// DELETE /api/push/unsubscribe — Remove a subscription
pushRoutes.delete('/unsubscribe', zValidator('json', unsubscribeSchema), async (c) => {
  const userId = c.get('userId');
  const { endpoint } = c.req.valid('json');

  await c.env.DB.prepare(
    'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?',
  ).bind(userId, endpoint).run();

  return c.json({ ok: true });
});

// GET /api/push/vapid-public-key — Get VAPID public key for frontend
pushRoutes.get('/vapid-public-key', async (c) => {
  return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY ?? '' });
});
