import { describe, it, expect, beforeEach, vi } from 'vitest';
import { call, resetDb, registerUser, authHeader, getTodaySeedId } from './helpers';
import type { Bindings } from '../src/types';

const FRAME_CSP = "frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

describe('Worker の応答のヘッダー（#120）', () => {
  let token: string;
  beforeEach(async () => {
    await resetDb();
    token = (await registerUser()).accessToken;
  });

  it('API の応答は no-store で、枠に入れさせず、nosniff と Referrer-Policy を付ける', async () => {
    for (const path of ['/api/health', '/api/user/profile', '/api/scores/my']) {
      const res = await call(`http://localhost${path}`, { headers: authHeader(token) });
      expect(res.status, path).toBe(200);
      expect(res.headers.get('Cache-Control'), path).toBe('no-store');
      expect(res.headers.get('Content-Security-Policy'), path).toBe(FRAME_CSP);
      expect(res.headers.get('X-Content-Type-Options'), path).toBe('nosniff');
      expect(res.headers.get('Referrer-Policy'), path).toBe('strict-origin-when-cross-origin');
    }
  });

  it('エラーの応答にも付ける', async () => {
    const res = await call('http://localhost/api/scores/my');
    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Security-Policy')).toBe(FRAME_CSP);
  });

  it('ID 基盤へ中継した応答（変えられないヘッダー）にも付ける', async () => {
    const ID = { fetch: async () => Response.redirect('https://example.com/', 302) } as unknown as Bindings['ID'];
    const res = await call('http://localhost/api/id/session', { method: 'POST' }, { ID });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://example.com/');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('共有ページは枠に入れさせないが、キャッシュの指定はそのまま', async () => {
    const seedId = await getTodaySeedId(token);
    const res = await call(`http://localhost/s/${seedId}`, { headers: { 'User-Agent': 'Twitterbot/1.0' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Security-Policy')).toBe(FRAME_CSP);
    expect(res.headers.get('Cache-Control')).toBeNull();
    const svg = await call(`http://localhost/s/${seedId}/ogp.svg`);
    expect(svg.headers.get('Cache-Control')).toBe('public, max-age=3600');
    expect(svg.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('本番のほかは noindex、本番は付けない', async () => {
    const dev = await call('http://localhost/api/health', undefined, { ENVIRONMENT: 'dev' });
    expect(dev.headers.get('X-Robots-Tag')).toBe('noindex');
    const prod = await call('http://localhost/api/health', undefined, { ENVIRONMENT: 'production' });
    expect(prod.headers.get('X-Robots-Tag')).toBeNull();
  });
});

describe('エラーの本文はコード', () => {
  beforeEach(resetDb);

  it('例外は internal_error の 500 にして、ログに出す', async () => {
    const { accessToken } = await registerUser();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const DB = { prepare: () => { throw new Error('boom'); } } as unknown as D1Database;
    const res = await call('http://localhost/api/user/profile', { headers: authHeader(accessToken) }, { DB });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal_error' });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(log.mock.calls.some(([line]) => String(line).includes('boom'))).toBe(true);
    log.mockRestore();
  });

  it('形の合わない本文と、JSON でない本文は invalid_request の 400', async () => {
    const { accessToken } = await registerUser();
    for (const body of ['{not json', JSON.stringify({ type: 123 })]) {
      const res = await call('http://localhost/api/achievements/unlock', {
        method: 'POST',
        headers: { ...authHeader(accessToken), 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body,
      });
      expect(res.status, body).toBe(400);
      expect(await res.json(), body).toEqual({ error: 'invalid_request' });
    }
  });

  it('ほかの 4xx もコードを返す', async () => {
    const { accessToken } = await registerUser();
    const res = await call('http://localhost/api/scores/nope/replay', { headers: authHeader(accessToken) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});
