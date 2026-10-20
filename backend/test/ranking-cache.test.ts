import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import {
  resetDb, registerUser, authHeader, submitReplay, submitScore, getTodaySeedId, insertPlayScore,
  useFakeToday, CLEARED_DATE, clearedRun,
} from './helpers';

/**
 * Ranking cache invalidation tests.
 *
 * Verifies the fix for:
 *   1. KV.delete is awaited independently after DB write (race condition prevention)
 *   2. DB unchanged -> cache is NOT deleted (dbModified flag)
 *   3. evaluateAchievements is separated from KV.delete
 *
 * Only cleared runs are ranked, and a short replay cannot clear a board, so the clock is fixed to
 * CLEARED_DATE, whose board the full greedy replay clears.
 */
describe('Ranking cache invalidation', () => {
  let accessToken: string;
  let userId: string;
  let seedId: string;
  let cacheKey: string;

  beforeEach(async () => {
    await resetDb();
    useFakeToday(CLEARED_DATE);
    const reg = await registerUser('550e8400-e29b-41d4-a716-446655440050');
    accessToken = reg.accessToken;
    userId = reg.userId;
    seedId = await getTodaySeedId(accessToken);
    cacheKey = `ranking:${seedId}:clear`;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Submit the run that clears today's board */
  async function submitClearedRun(token: string) {
    const { replayLog, state } = clearedRun();
    expect(state.isCleared).toBe(true);
    const res = await submitScore(token, { date: CLEARED_DATE, mode: 'clear', replayLog });
    return { status: res.status, data: await res.json() as Record<string, unknown>, state };
  }

  /** Helper: fetch ranking for the seed */
  async function fetchRanking(token: string) {
    const res = await SELF.fetch(`http://localhost/api/rankings/${seedId}`, {
      headers: authHeader(token),
    });
    return res.json() as Promise<{
      ranking: Array<{ rank: number; score: number; moveCount: number; userId: string }>;
      userRank: { rank: number; score: number; moveCount: number } | null;
    }>;
  }

  it('new score submission invalidates ranking cache', async () => {
    // Step 1: A cleared record from another user
    const other = await registerUser('550e8400-e29b-41d4-a716-446655440051');
    await insertPlayScore({ userId: other.userId, seedId, moveCount: 50, score: 100, isCleared: true });

    // Step 2: Fetch ranking to populate cache
    const ranking1 = await fetchRanking(accessToken);
    expect(ranking1.ranking).toHaveLength(1);
    expect(await env.KV.get(cacheKey)).not.toBeNull();

    // Step 3: This user submits a cleared run with fewer moves
    const cleared = await submitClearedRun(accessToken);
    expect(cleared.status).toBe(201);

    // Step 4: Cache should be invalidated (deleted) after DB write
    expect(await env.KV.get(cacheKey)).toBeNull();

    // Step 5: Ranking should reflect the new record from DB
    const ranking2 = await fetchRanking(accessToken);
    expect(ranking2.ranking.map(e => e.userId)).toEqual([userId, other.userId]);
    expect(ranking2.ranking[0].moveCount).toBe(cleared.state.moveCount);
    expect(ranking2.userRank).toEqual({ rank: 1, score: cleared.state.score, moveCount: cleared.state.moveCount });
  });

  it('better score (upsert) invalidates ranking cache', async () => {
    // Step 1: An uncleared run is stored but not ranked
    const { res } = await submitReplay(accessToken, 1);
    expect(res.status).toBe(201);

    // Step 2: Populate cache
    expect((await fetchRanking(accessToken)).ranking).toHaveLength(0);
    expect(await env.KV.get(cacheKey)).not.toBeNull();

    // Step 3: Submit a cleared run (triggers UPDATE)
    const cleared = await submitClearedRun(accessToken);
    expect(cleared.status).toBe(201);

    // Step 4: Cache should be invalidated
    expect(await env.KV.get(cacheKey)).toBeNull();

    // Step 5: Ranking reflects updated record
    const ranking = await fetchRanking(accessToken);
    expect(ranking.ranking).toHaveLength(1);
    expect(ranking.ranking[0].score).toBe(cleared.state.score);
  });

  it('non-improving score does NOT invalidate ranking cache', async () => {
    // Step 1: Clear first
    const cleared = await submitClearedRun(accessToken);

    // Step 2: Populate cache by fetching ranking
    await fetchRanking(accessToken);
    expect(await env.KV.get(cacheKey)).not.toBeNull();

    // Step 3: Submit an uncleared run (should NOT modify DB)
    const { res } = await submitReplay(accessToken, 1);
    expect(res.status).toBe(201);

    // Step 4: Cache should still exist (dbModified = false)
    expect(await env.KV.get(cacheKey)).not.toBeNull();

    // Step 5: Ranking still shows the cleared record
    const ranking = await fetchRanking(accessToken);
    expect(ranking.ranking).toHaveLength(1);
    expect(ranking.ranking[0].moveCount).toBe(cleared.state.moveCount);
  });

  it('score response still includes achievements even after cache separation', async () => {
    // Verify the response structure is intact after separating
    // evaluateAchievements from KV.delete
    const { res } = await submitReplay(accessToken, 1);
    expect(res.status).toBe(201);
    const data = await res.json() as Record<string, unknown>;
    expect(data).toHaveProperty('scoreId');
    expect(data).toHaveProperty('shareCode');
    expect(data).toHaveProperty('newAchievements');
    expect(Array.isArray(data.newAchievements)).toBe(true);
    expect(data).toHaveProperty('verifiedScore');
    expect(data).toHaveProperty('verifiedMoveCount');
  });

  it('ranking reflects latest data after cache invalidation from concurrent users', async () => {
    // Users 2 and 3 have cleared records with more moves than the cleared run
    const reg2 = await registerUser('550e8400-e29b-41d4-a716-446655440052');
    const reg3 = await registerUser('550e8400-e29b-41d4-a716-446655440053');
    await insertPlayScore({ userId: reg2.userId, seedId, moveCount: 60, score: 100, isCleared: true });
    await insertPlayScore({ userId: reg3.userId, seedId, moveCount: 50, score: 100, isCleared: true });

    // Populate cache
    await fetchRanking(accessToken);

    await submitClearedRun(accessToken);
    expect(await env.KV.get(cacheKey)).toBeNull();

    // Ranking should show all 3 users in correct order
    const ranking = await fetchRanking(accessToken);
    expect(ranking.ranking.map(e => e.userId)).toEqual([userId, reg3.userId, reg2.userId]);
  });
});
