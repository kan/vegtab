import { describe, it, expect, beforeEach } from 'vitest';
import { SELF } from 'cloudflare:test';
import { applyMigrations, registerUser, authHeader, subscribePush } from './helpers';

describe('Push Notification API', () => {
  let accessToken: string;

  beforeEach(async () => {
    await applyMigrations();
    const reg = await registerUser('550e8400-e29b-41d4-a716-446655440030');
    accessToken = reg.accessToken;
  });

  const endpoint = 'https://fcm.googleapis.com/fcm/send/test-endpoint-123';

  it('POST /api/push/subscribe — 正常登録', async () => {
    const res = await subscribePush(accessToken, endpoint);
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean };
    expect(data.ok).toBe(true);
  });

  it('POST /api/push/subscribe — 同一endpointでUPSERT', async () => {
    await subscribePush(accessToken, endpoint);

    // Second registration with same endpoint (should update, not error)
    const res = await subscribePush(accessToken, endpoint);
    expect(res.status).toBe(200);
  });

  it('DELETE /api/push/unsubscribe — 正常削除', async () => {
    await subscribePush(accessToken, endpoint);

    const res = await SELF.fetch('http://localhost/api/push/unsubscribe', {
      method: 'DELETE',
      headers: { ...authHeader(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean };
    expect(data.ok).toBe(true);
  });

  it('GET /api/push/vapid-public-key — 公開鍵取得', async () => {
    const res = await SELF.fetch('http://localhost/api/push/vapid-public-key', {
      headers: authHeader(accessToken),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { publicKey: string };
    expect(data.publicKey).toBeTruthy();
  });

  it('未認証アクセスは拒否', async () => {
    const res = await subscribePush(null, endpoint);
    expect(res.status).toBe(401);
  });
});
