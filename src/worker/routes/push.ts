import type { AccountRequest, Route } from '../router';
import { json, readJsonBody } from '../lib/http';
import { isRecord, isStringOfLength } from '../lib/validate';
import { generateId } from '../lib/id';
import { isPushServiceEndpoint } from '../lib/web-push';

const MAX_SUBSCRIPTIONS_PER_USER = 5;
const MAX_ENDPOINT_LENGTH = 2048;

interface Subscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function parseSubscription(body: unknown): Subscription | undefined {
  if (!isRecord(body) || !isRecord(body.keys)) return undefined;
  const { endpoint, keys: { p256dh, auth } } = body;
  if (!isStringOfLength(endpoint, 0, MAX_ENDPOINT_LENGTH) || !isPushServiceEndpoint(endpoint)) return undefined;
  if (!isStringOfLength(p256dh, 1, 256) || !isStringOfLength(auth, 1, 256)) return undefined;
  return { endpoint, keys: { p256dh, auth } };
}

export const pushRoutes: Route<AccountRequest>[] = [
  // POST /api/push/subscribe — Register or update a push subscription
  {
    method: 'POST',
    path: '/api/push/subscribe',
    async handler({ request, env, accountId }) {
      const subscription = await readJsonBody(request, parseSubscription);
      if (subscription instanceof Response) return subscription;
      const { endpoint, keys } = subscription;

      await env.DB.batch([
        // An endpoint already owned by another user is left untouched
        env.DB.prepare(`
          INSERT INTO push_subscriptions (id, user_id, endpoint, key_p256dh, key_auth)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (endpoint) DO UPDATE SET
            key_p256dh = excluded.key_p256dh,
            key_auth = excluded.key_auth
          WHERE push_subscriptions.user_id = excluded.user_id
        `).bind(generateId(), accountId, endpoint, keys.p256dh, keys.auth),
        // Keep only the newest subscriptions per user
        env.DB.prepare(`
          DELETE FROM push_subscriptions
          WHERE user_id = ? AND rowid NOT IN (
            SELECT rowid FROM push_subscriptions WHERE user_id = ? ORDER BY rowid DESC LIMIT ?
          )
        `).bind(accountId, accountId, MAX_SUBSCRIPTIONS_PER_USER),
      ]);

      return json({ ok: true });
    },
  },

  // DELETE /api/push/unsubscribe — Remove a subscription.
  // It only deletes the caller's own rows, so no host check is needed
  {
    method: 'DELETE',
    path: '/api/push/unsubscribe',
    async handler({ request, env, accountId }) {
      const endpoint = await readJsonBody(request, (body) =>
        isRecord(body) && isStringOfLength(body.endpoint, 0, MAX_ENDPOINT_LENGTH) ? body.endpoint : undefined);
      if (endpoint instanceof Response) return endpoint;

      await env.DB.prepare(
        'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?',
      ).bind(accountId, endpoint).run();

      return json({ ok: true });
    },
  },

  // GET /api/push/vapid-public-key — Get VAPID public key for frontend
  {
    method: 'GET',
    path: '/api/push/vapid-public-key',
    handler: ({ env }) => json({ publicKey: env.VAPID_PUBLIC_KEY ?? '' }),
  },
];
