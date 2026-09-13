import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Bindings, Variables } from '../types';
import { generateId } from '../lib/id';
import { isPushServiceEndpoint } from '../lib/web-push';

const MAX_SUBSCRIPTIONS_PER_USER = 5;
const MAX_ENDPOINT_LENGTH = 2048;

const subscribeSchema = z.object({
  endpoint: z.string().max(MAX_ENDPOINT_LENGTH).refine(isPushServiceEndpoint, 'Unsupported push endpoint'),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
});

// Unsubscribe only deletes the caller's own rows, so no host check is needed
const unsubscribeSchema = z.object({
  endpoint: z.string().max(MAX_ENDPOINT_LENGTH),
});

export const pushRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// POST /api/push/subscribe — Register or update a push subscription
pushRoutes.post('/subscribe', zValidator('json', subscribeSchema), async (c) => {
  const userId = c.get('userId');
  const { endpoint, keys } = c.req.valid('json');

  await c.env.DB.batch([
    // An endpoint already owned by another user is left untouched
    c.env.DB.prepare(`
      INSERT INTO push_subscriptions (id, user_id, endpoint, key_p256dh, key_auth)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (endpoint) DO UPDATE SET
        key_p256dh = excluded.key_p256dh,
        key_auth = excluded.key_auth
      WHERE push_subscriptions.user_id = excluded.user_id
    `).bind(generateId(), userId, endpoint, keys.p256dh, keys.auth),
    // Keep only the newest subscriptions per user
    c.env.DB.prepare(`
      DELETE FROM push_subscriptions
      WHERE user_id = ? AND rowid NOT IN (
        SELECT rowid FROM push_subscriptions WHERE user_id = ? ORDER BY rowid DESC LIMIT ?
      )
    `).bind(userId, userId, MAX_SUBSCRIPTIONS_PER_USER),
  ]);

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