import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import {
  call, resetDb, registerUser, authHeader, submitScore, buildReplay, useFakeToday,
} from './helpers';
import { RATE_LIMITS, purgeStaleRateLimits, takeRateLimitSlot } from '../../src/worker/lib/rate-limit';
import { todayJST } from '../../src/worker/lib/date';
import * as replayVerify from '../../src/worker/lib/replay-verify';

const TODAY = '2026-11-16';
const { limit, windowMs } = RATE_LIMITS.score;

describe('POST /api/scores の回数の制限（#119）', () => {
  let token: string;
  let replayLog: unknown[];

  beforeEach(async () => {
    await resetDb();
    useFakeToday(TODAY);
    token = (await registerUser()).accessToken;
    replayLog = (await buildReplay(2, TODAY)).replayLog;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const submit = (t = token, log = replayLog) => submitScore(t, { date: todayJST(), mode: 'clear', replayLog: log });

  it('上限を超えた送信は、リプレイを検証する前に 429 で断る', async () => {
    for (let i = 0; i < limit; i++) expect((await submit()).status, `#${i}`).toBe(201);

    const verify = vi.spyOn(replayVerify, 'verifyReplay');
    // 不正なリプレイでも 400 ではなく 429: 検証より前に断っている
    const res = await submit(token, [{ type: 'swap', pos: { row: 0, col: 0 }, dir: 'up' }]);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    const retryAfter = Number(res.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(windowMs / 1000);
    expect(verify).not.toHaveBeenCalled();
  });

  it('次の時間枠になれば、また送れる', async () => {
    for (let i = 0; i < limit; i++) await submit();
    expect((await submit()).status).toBe(429);
    vi.setSystemTime(Date.now() + windowMs);
    expect((await submit()).status).toBe(201);
  });

  it('ID ごとに数える', async () => {
    for (let i = 0; i < limit; i++) await submit();
    expect((await submit()).status).toBe(429);
    const other = (await registerUser()).accessToken;
    expect((await submit(other)).status).toBe(201);
  });

  it('締め切った日の送信（検証しない）は数えない', async () => {
    for (let i = 0; i < limit + 2; i++) {
      const res = await submitScore(token, { date: '2026-11-01', mode: 'clear', replayLog });
      expect(res.status).toBe(200);
    }
    expect((await submit()).status).toBe(201);
  });
});

describe('POST /api/user/profile の回数の制限', () => {
  beforeEach(resetDb);

  it('上限を超えたら、ID 基盤に問い合わせずに 429', async () => {
    const { accessToken } = await registerUser();
    const post = (displayName: string) => call('http://localhost/api/user/profile', {
      method: 'POST',
      headers: { ...authHeader(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName, consent: true }),
    });
    // 規則に合わない名前は ID 基盤が断るが、枠は使う
    for (let i = 0; i < RATE_LIMITS.profile.limit; i++) expect((await post('!')).status).toBe(400);
    const res = await post('ValidName');
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).not.toBeNull();
  });
});

describe('rate_limits の掃除', () => {
  beforeEach(resetDb);

  it('1 日より前の時間枠の行を消し、新しい行は残す', async () => {
    const now = Date.UTC(2026, 10, 16, 3);
    await takeRateLimitSlot(env.DB, 'old', 'score', now - 2 * 24 * 60 * 60 * 1000);
    await takeRateLimitSlot(env.DB, 'new', 'score', now - 60_000);
    await purgeStaleRateLimits(env.DB, now);
    const { results } = await env.DB.prepare('SELECT account_id FROM rate_limits').all<{ account_id: string }>();
    expect(results.map(r => r.account_id)).toEqual(['new']);
  });

  it('同じ時間枠の中で数え、上限を超えた分だけ断る', async () => {
    const now = Date.UTC(2026, 10, 16, 3, 0, 30);
    for (let i = 0; i < limit; i++) expect(await takeRateLimitSlot(env.DB, 'a', 'score', now)).toBeNull();
    expect(await takeRateLimitSlot(env.DB, 'a', 'score', now)).toEqual({ retryAfterSeconds: 30 });
    expect(await takeRateLimitSlot(env.DB, 'a', 'profile', now)).toBeNull();
  });
});
