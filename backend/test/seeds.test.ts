import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  call, resetDb, registerUser, authHeader, submitReplay, submitScore, getTodaySeedId, insertPlayScore, useFakeToday,
} from './helpers';
import { todayJST } from '../src/lib/date';

describe('Seeds & Ranking API', () => {
  let accessToken: string;
  let userId: string;

  beforeEach(async () => {
    await resetDb();
    const reg = await registerUser({ name: 'Me' });
    accessToken = reg.accessToken;
    userId = reg.userId;
  });

  it('gets daily seed (auto-creates if missing)', async () => {
    const res = await call('http://localhost/api/seeds/daily', {
      headers: authHeader(accessToken),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { seedId: string; date: string; shareCode: string };
    expect(data.seedId).toBeTruthy();
    expect(data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.shareCode).toHaveLength(6);
  });

  async function fetchSeedInfo(seedId: string) {
    const res = await call(`http://localhost/api/seeds/${seedId}`, { headers: authHeader(accessToken) });
    return res.json() as Promise<{ seedId: string; best: { isCleared: boolean; moveCount: number; clearTimeMs: number | null; score: number } | null }>;
  }

  it('seed info returns null best before playing', async () => {
    const seedId = await getTodaySeedId(accessToken);
    const info = await fetchSeedInfo(seedId);
    expect(info.seedId).toBe(seedId);
    expect(info.best).toBeNull();
  });

  it('seed info returns the stored Clear best, ignoring removed modes', async () => {
    const seedId = await getTodaySeedId(accessToken);
    await insertPlayScore({ userId, seedId, mode: 'sprint', moveCount: 15, score: 9000 });
    expect((await fetchSeedInfo(seedId)).best).toBeNull();

    await insertPlayScore({ userId, seedId, moveCount: 12, score: 300, isCleared: true, clearTimeMs: 83_000 });
    expect((await fetchSeedInfo(seedId)).best).toEqual({ isCleared: true, moveCount: 12, clearTimeMs: 83_000, score: 300 });
  });

  it('calendar returns the stored Clear best per seed, ignoring removed modes', async () => {
    const seedId = await getTodaySeedId(accessToken);
    await insertPlayScore({ userId, seedId, mode: 'sprint', moveCount: 15, score: 9000 });
    await insertPlayScore({ userId, seedId, moveCount: 40, score: 500, isCleared: false });

    const res = await call(`http://localhost/api/seeds/daily/calendar?month=${todayJST().slice(0, 7)}`, {
      headers: authHeader(accessToken),
    });
    const { seeds } = await res.json() as { seeds: Array<{ seedId: string; userScores: unknown }> };
    expect(seeds.find(s => s.seedId === seedId)?.userScores).toEqual({ isCleared: false, moveCount: 40, clearTimeMs: null, score: 500 });
  });

  it('calendar returns null userScores for unplayed seeds', async () => {
    const seedId = await getTodaySeedId(accessToken);
    await insertPlayScore({ userId, seedId, mode: 'cascade', moveCount: 15, score: 9000, cascadePoints: 20 });

    const res = await call(`http://localhost/api/seeds/daily/calendar?month=${todayJST().slice(0, 7)}`, {
      headers: authHeader(accessToken),
    });
    const { seeds } = await res.json() as { seeds: Array<{ seedId: string; userScores: unknown }> };
    expect(seeds.find(s => s.seedId === seedId)?.userScores).toBeNull();
  });

  it.each(['', '?month=2026-13', '?month=2026-1', '?month=abc'])('calendar rejects a missing or malformed month (%s)', async (query) => {
    const res = await call(`http://localhost/api/seeds/daily/calendar${query}`, { headers: authHeader(accessToken) });
    expect(res.status).toBe(400);
  });

  describe('the seeds of days not handed out yet (#116)', () => {
    afterEach(() => vi.useRealTimers());

    type CalendarSeed = { seedId: string | null; seedValue: string; date: string };
    async function calendar(month: string): Promise<CalendarSeed[]> {
      const res = await call(`http://localhost/api/seeds/daily/calendar?month=${month}`, { headers: authHeader(accessToken) });
      expect(res.status).toBe(200);
      return (await res.json() as { seeds: CalendarSeed[] }).seeds;
    }

    it('calendar lists every day of the month up to today, and none after it', async () => {
      useFakeToday('2026-11-20');
      const seeds = await calendar('2026-11');
      expect(seeds.map(s => s.date)).toEqual(
        Array.from({ length: 20 }, (_, i) => `2026-11-${String(20 - i).padStart(2, '0')}`),
      );
      expect(await calendar('2026-12')).toEqual([]);
    });

    it('a day without a row gets the value that /daily stores for it later, without writing a row', async () => {
      useFakeToday('2026-11-20');
      const [listed] = await calendar('2026-11');
      expect(listed).toMatchObject({ date: '2026-11-20', seedId: null });
      const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM puzzle_seeds').first<{ n: number }>();
      expect(rows?.n).toBe(0);

      const res = await call('http://localhost/api/seeds/daily', { headers: authHeader(accessToken) });
      const daily = await res.json() as { seedId: string; seedValue: string };
      expect(daily.seedValue).toBe(listed.seedValue);
      expect((await calendar('2026-11'))[0]).toMatchObject({ seedId: daily.seedId, seedValue: daily.seedValue });
    });

    it('a stored row wins over the derived value', async () => {
      useFakeToday('2026-11-20');
      await env.DB.prepare(
        "INSERT INTO puzzle_seeds (id, seed_value, share_code, is_daily, daily_date) VALUES ('old', '12345', 'ABCDEF', 1, '2026-11-20')"
      ).run();
      const res = await call('http://localhost/api/seeds/daily', { headers: authHeader(accessToken) });
      expect(await res.json()).toMatchObject({ seedId: 'old', seedValue: '12345' });
      expect((await calendar('2026-11'))[0]).toMatchObject({ seedId: 'old', seedValue: '12345' });
    });

    it('a score for tomorrow is refused, so its seed is not created', async () => {
      useFakeToday('2026-11-20');
      const res = await submitScore(accessToken, {
        date: '2026-11-21', mode: 'clear', replayLog: [{ type: 'swap', pos: { row: 0, col: 0 }, dir: 'right' }],
      });
      expect(res.status).toBe(400);
      const row = await env.DB.prepare("SELECT 1 FROM puzzle_seeds WHERE daily_date = '2026-11-21'").first();
      expect(row).toBeNull();
    });
  });

  it('score submission creates seed and returns shareCode', async () => {
    const { res } = await submitReplay(accessToken, 1);
    expect(res.status).toBe(201);
    const data = await res.json() as { scoreId: string; shareCode: string };
    expect(data.scoreId).toBeTruthy();
    expect(data.shareCode).toHaveLength(6);
  });

  it('rejects score for invalid date', async () => {
    const { res } = await submitReplay(accessToken, 1, { date: '2020-01-01' });
    expect(res.status).toBe(400);
  });

  it('an uncleared run is stored but not ranked', async () => {
    const { res } = await submitReplay(accessToken, 2);
    expect(res.status).toBe(201);
    const seedId = await getTodaySeedId(accessToken);

    const rankRes = await call(`http://localhost/api/rankings/${seedId}`, { headers: authHeader(accessToken) });
    expect(rankRes.status).toBe(200);
    expect(await rankRes.json()).toEqual({ ranking: [], userRank: null });
  });

  it('ranking uses the fewest moves among cleared plays', async () => {
    // Cleared plays cannot be produced by short replays, so the rows are inserted directly
    // (one row per user and seed×mode, so the other results belong to other users)
    const seedId = await getTodaySeedId(accessToken);
    const slower = await registerUser({ name: 'Slower' });
    const notCleared = await registerUser({ name: 'NotCleared' });
    await insertPlayScore({ userId: slower.userId, seedId, moveCount: 20, score: 3000, isCleared: true });
    await insertPlayScore({ userId, seedId, moveCount: 12, score: 2000, isCleared: true });
    await insertPlayScore({ userId: notCleared.userId, seedId, moveCount: 5, score: 500, isCleared: false });

    const rankRes = await call(`http://localhost/api/rankings/${seedId}`, {
      headers: authHeader(accessToken),
    });
    expect(rankRes.status).toBe(200);
    const rankData = await rankRes.json() as {
      ranking: Array<{ rank: number; moveCount: number; clearTimeMs: number | null; isCleared: boolean }>;
      userRank: { rank: number; moveCount: number; clearTimeMs: number | null } | null;
    };
    // Uncleared plays are not ranked; fewest moves first
    expect(rankData.ranking.map(e => e.moveCount)).toEqual([12, 20]);
    expect(rankData.ranking[0].isCleared).toBe(true);
    expect(rankData.userRank).toEqual({ rank: 1, score: 2000, moveCount: 12, clearTimeMs: null });
  });
});
