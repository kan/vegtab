import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { registerUser, subscribePush, PUSH_KEYS } from './helpers';
import { sendDailyPushNotifications } from '../src/lib/push-cron';
import type { Bindings } from '../src/types';

async function ownersOfEndpoint(endpoint: string) {
  const rows = await env.DB.prepare('SELECT user_id FROM push_subscriptions WHERE endpoint = ?')
    .bind(endpoint).all<{ user_id: string }>();
  return rows.results.map((r) => r.user_id);
}

describe('Push subscription validation', () => {
  let accessToken: string;
  let userId: string;

  beforeEach(async () => {
    ({ accessToken, userId } = await registerUser());
  });

  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/abc',
    'https://wns2-by3p.notify.windows.com/w/?token=abc',
  ])('accepts a push service endpoint: %s', async (endpoint) => {
    const res = await subscribePush(accessToken, endpoint);
    expect(res.status).toBe(200);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://attacker.example/collect',
    'https://fcm.googleapis.com.attacker.example/abc',
    'not a url',
  ])('rejects a non push service endpoint: %s', async (endpoint) => {
    const res = await subscribePush(accessToken, endpoint);
    expect(res.status).toBe(400);
  });

  it('does not reassign an endpoint that belongs to another user', async () => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/owned-${crypto.randomUUID()}`;
    await subscribePush(accessToken, endpoint);

    const other = await registerUser();
    const res = await subscribePush(other.accessToken, endpoint);
    expect(res.status).toBe(200);
    expect(await ownersOfEndpoint(endpoint)).toEqual([userId]);
  });

  it('keeps only the newest subscriptions per user', async () => {
    const prefix = `https://fcm.googleapis.com/fcm/send/cap-${crypto.randomUUID()}-`;
    for (let i = 0; i < 7; i++) {
      await subscribePush(accessToken, `${prefix}${i}`);
    }
    const rows = await env.DB.prepare('SELECT endpoint FROM push_subscriptions WHERE user_id = ? ORDER BY endpoint')
      .bind(userId).all<{ endpoint: string }>();
    expect(rows.results.map((r) => r.endpoint)).toEqual([2, 3, 4, 5, 6].map((i) => `${prefix}${i}`));
  });

  it('daily cron removes endpoints stored before host validation instead of POSTing to them', async () => {
    const endpoint = `https://attacker.example/collect-${crypto.randomUUID()}`;
    await env.DB.prepare(
      'INSERT INTO push_subscriptions (id, user_id, endpoint, key_p256dh, key_auth) VALUES (?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), userId, endpoint, PUSH_KEYS.p256dh, PUSH_KEYS.auth).run();

    await sendDailyPushNotifications(env as unknown as Bindings);

    expect(await ownersOfEndpoint(endpoint)).toEqual([]);
  });
});
