import { describe, it, expect, beforeEach } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { registerUser, authHeader } from './helpers';

async function issueCode(token: string) {
  const res = await SELF.fetch('http://localhost/api/auth/transfer-code', {
    method: 'POST',
    headers: authHeader(token),
  });
  expect(res.status).toBe(200);
  return (await res.json() as { code: string }).code;
}

/** Each test uses its own client IP so the per-IP rate limit doesn't leak between tests */
function redeem(code: string, clientIp: string, deviceId: string = crypto.randomUUID()) {
  return SELF.fetch('http://localhost/api/auth/redeem-transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': clientIp },
    body: JSON.stringify({ code, deviceId }),
  });
}

describe('Account transfer codes', () => {
  let accessToken: string;
  let userId: string;

  beforeEach(async () => {
    ({ accessToken, userId } = await registerUser(crypto.randomUUID()));
  });

  it('links a new device to the account and can be redeemed only once', async () => {
    const code = await issueCode(accessToken);

    const first = await redeem(code, '203.0.113.1');
    expect(first.status).toBe(200);
    expect((await first.json() as { userId: string }).userId).toBe(userId);

    const second = await redeem(code, '203.0.113.1');
    expect(second.status).toBe(400);
  });

  it('accepts the code case-insensitively', async () => {
    const code = await issueCode(accessToken);
    const res = await redeem(code.toLowerCase(), '203.0.113.2');
    expect(res.status).toBe(200);
  });

  it('invalidates the previous code when a new one is issued', async () => {
    const oldCode = await issueCode(accessToken);
    const newCode = await issueCode(accessToken);

    expect((await redeem(oldCode, '203.0.113.3')).status).toBe(400);
    expect((await redeem(newCode, '203.0.113.3')).status).toBe(200);
  });

  it('relinks a device that already belongs to another account', async () => {
    const deviceId = crypto.randomUUID();
    const other = await registerUser(deviceId);
    expect(other.userId).not.toBe(userId);

    const code = await issueCode(accessToken);
    const res = await redeem(code, '203.0.113.6', deviceId);
    expect(res.status).toBe(200);

    const link = await env.DB.prepare('SELECT user_id FROM user_devices WHERE device_id = ?')
      .bind(deviceId).first<{ user_id: string }>();
    expect(link?.user_id).toBe(userId);
    // Re-registering from that device now resolves to the transferred account
    expect((await registerUser(deviceId)).userId).toBe(userId);
  });

  it('does not link the device when the code is invalid', async () => {
    const deviceId = crypto.randomUUID();
    const res = await redeem('NOTACODE', '203.0.113.7', deviceId);
    expect(res.status).toBe(400);

    const link = await env.DB.prepare('SELECT user_id FROM user_devices WHERE device_id = ?')
      .bind(deviceId).first<{ user_id: string }>();
    expect(link).toBeNull();
  });

  it('rejects an expired code', async () => {
    await env.DB.prepare(
      "INSERT INTO transfer_codes (code, user_id, expires_at) VALUES (?, ?, datetime('now', '-1 seconds'))"
    ).bind('EXPIRED1', userId).run();

    const res = await redeem('EXPIRED1', '203.0.113.4');
    expect(res.status).toBe(400);
  });

  it('rate limits repeated attempts from the same client IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await redeem('WRONGCOD', '203.0.113.5')).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
