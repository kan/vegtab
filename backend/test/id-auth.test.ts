import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { call, resetDb, registerUser, authHeader, idIssuer, ORIGIN } from './helpers';
import { createTestIdIssuer } from './kan-game/test-id-cookie';
import type { Bindings } from '../src/types';

describe('kan-game.app ID cookie', () => {
  beforeEach(resetDb);

  it('accepts a request with a valid cookie', async () => {
    const { accessToken } = await registerUser();
    const res = await call('http://localhost/api/user/profile', { headers: authHeader(accessToken) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ displayName: null });
  });

  it('answers 401 without a cookie, and for a cookie signed with an unknown key or for another issuer', async () => {
    const stranger = await createTestIdIssuer({ issuer: idIssuer.issuer, cookieName: idIssuer.cookieName });
    const id = crypto.randomUUID();
    for (const cookie of [
      undefined,
      await stranger.cookie(id),
      await idIssuer.cookie(id, { iss: 'kan-game.app' }),
    ]) {
      const res = await call('http://localhost/api/user/profile', { headers: cookie ? authHeader(cookie) : {} });
      expect(res.status).toBe(401);
    }
  });

  it('answers 410 for a withdrawn ID', async () => {
    const { userId, accessToken } = await registerUser();
    await env.DB.prepare('INSERT INTO deleted_accounts (account_id, deleted_at) VALUES (?, ?)').bind(userId, Date.now()).run();
    const res = await call('http://localhost/api/user/profile', { headers: authHeader(accessToken) });
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'id_deleted' });
  });

  it('refuses a write from another origin or without Origin, but allows a same-origin GET without it', async () => {
    const { accessToken } = await registerUser();
    const post = (headers: Record<string, string>) => call('http://localhost/api/achievements/unlock', {
      method: 'POST',
      headers: { Cookie: accessToken, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ type: 'tutorial_complete' }),
    });
    expect((await post({ Origin: 'https://evil.example' })).status).toBe(403);
    expect((await post({})).status).toBe(403);
    expect((await post({ Origin: ORIGIN })).status).toBe(200);

    const get = await call('http://localhost/api/achievements', { headers: { Cookie: accessToken } });
    expect(get.status).toBe(200);
  });
});

describe('/api/id/* goes to the ID platform', () => {
  it('passes the request on unchanged and returns its answer', async () => {
    let received: Request | undefined;
    const ID = {
      fetch: async (request: Request) => {
        received = request;
        return Response.json({ id: 'x', name: null, status: 'active' }, { headers: { 'Set-Cookie': 'a=b' } });
      },
    } as unknown as Bindings['ID'];
    const res = await call('http://localhost/api/id/session', {
      method: 'POST', headers: { Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.9' },
    }, { ID });
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toBe('a=b');
    expect(received?.url).toBe('http://localhost/api/id/session');
    expect(received?.headers.get('CF-Connecting-IP')).toBe('203.0.113.9');
  });

  it('answers 503 when the ID platform cannot be reached', async () => {
    const ID = { fetch: async () => { throw new Error('down'); } } as unknown as Bindings['ID'];
    const res = await call('http://localhost/api/id/session', { method: 'POST', headers: { Origin: ORIGIN } }, { ID });
    expect(res.status).toBe(503);
  });
});
