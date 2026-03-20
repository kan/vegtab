import type { Bindings } from '../types';
import { sendPushNotification, importVapidKeys, type PushPayload } from './web-push';

const BATCH_SIZE = 100;

export async function sendDailyPushNotifications(env: Bindings): Promise<void> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;

  const vapidKeys = await importVapidKeys(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const payload: PushPayload = {
    title: 'Vege-Table',
    body: "Today's daily puzzle is ready! 🥬",
    icon: '/pwa-192x192.png',
    url: '/',
  };

  let offset = 0;
  const staleEndpoints: string[] = [];

  while (true) {
    const batch = await env.DB.prepare(
      'SELECT endpoint, key_p256dh, key_auth FROM push_subscriptions LIMIT ? OFFSET ?',
    ).bind(BATCH_SIZE, offset).all<{
      endpoint: string; key_p256dh: string; key_auth: string;
    }>();

    const rows = batch.results ?? [];
    if (rows.length === 0) break;

    const results = await Promise.allSettled(
      rows.map(sub =>
        sendPushNotification(
          { endpoint: sub.endpoint, keyP256dh: sub.key_p256dh, keyAuth: sub.key_auth },
          payload,
          vapidKeys,
          env.VAPID_SUBJECT,
        ),
      ),
    );

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled' && r.value.gone) {
        staleEndpoints.push(rows[i].endpoint);
      }
    }

    offset += BATCH_SIZE;
    if (rows.length < BATCH_SIZE) break;
  }

  // Clean up stale subscriptions
  if (staleEndpoints.length > 0) {
    const stmts = staleEndpoints.map(ep =>
      env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(ep),
    );
    for (let i = 0; i < stmts.length; i += 100) {
      await env.DB.batch(stmts.slice(i, i + 100));
    }
  }
}
