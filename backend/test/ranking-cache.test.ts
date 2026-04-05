import { describe, it, expect, beforeEach } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { applyMigrations, registerUser, authHeader } from './helpers';
import { todayJST } from '../src/lib/date';

/**
 * Ranking cache invalidation tests.
 *
 * Verifies the fix for:
 *   1. KV.delete is awaited independently after DB write (race condition prevention)
 *   2. DB unchanged -> cache is NOT deleted (dbModified flag)
 *   3. evaluateAchievements is separated from KV.delete
 */
describe('Ranking cache invalidation', () => {
  let accessToken: string;
  let userId: string;

  beforeEach(async () => {
    await applyMigrations();
    // Clear data from previous tests to ensure isolation
    await env.DB.exec('DELETE FROM achievements');
    await env.DB.exec('DELETE FROM play_scores');
    await env.DB.exec('DELETE FROM puzzle_seeds');
    await env.DB.exec('DELETE FROM user_devices');
    await env.DB.exec('DELETE FROM users');
    const reg = await registerUser('550e8400-e29b-41d4-a716-446655440050');
    accessToken = reg.accessToken;
    userId = reg.userId;
  });

  /** Helper: submit a sprint score and return the response data */
  async function submitSprintScore(
    token: string,
    score: number,
    opts?: { moveCount?: number; moveLimit?: number },
  ) {
    const today = todayJST();
    const res = await SELF.fetch('http://localhost/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(token) },
      body: JSON.stringify({
        date: today,
        mode: 'sprint',
        moveLimit: opts?.moveLimit ?? 15,
        moveCount: opts?.moveCount ?? 15,
        score,
        isCleared: true,
        replayLog: [],
      }),
    });
    return { status: res.status, data: await res.json() as Record<string, unknown> };
  }

  /** Helper: get seedId for today */
  async function getTodaySeedId(token: string): Promise<string> {
    const res = await SELF.fetch('http://localhost/api/seeds/daily', {
      headers: authHeader(token),
    });
    const data = await res.json() as { seedId: string };
    return data.seedId;
  }

  /** Helper: fetch ranking for a seed */
  async function fetchRanking(token: string, seedId: string, mode = 'sprint') {
    const res = await SELF.fetch(`http://localhost/api/rankings/${seedId}?mode=${mode}`, {
      headers: authHeader(token),
    });
    return res.json() as Promise<{
      ranking: Array<{ rank: number; score: number; moveCount: number; userId: string }>;
      userRank: { rank: number; score: number } | null;
    }>;
  }

  it('new score submission invalidates ranking cache', async () => {
    // Step 1: Submit first score (creates seed)
    const { status } = await submitSprintScore(accessToken, 3000);
    expect(status).toBe(201);

    const seedId = await getTodaySeedId(accessToken);

    // Step 2: Fetch ranking to populate cache
    const ranking1 = await fetchRanking(accessToken, seedId);
    expect(ranking1.ranking).toHaveLength(1);
    expect(ranking1.ranking[0].score).toBe(3000);

    // Verify cache exists in KV
    const cacheKey = `ranking:${seedId}:sprint`;
    const cached = await env.KV.get(cacheKey);
    expect(cached).not.toBeNull();

    // Step 3: Second user submits a higher score
    const reg2 = await registerUser('550e8400-e29b-41d4-a716-446655440051');
    const { status: status2 } = await submitSprintScore(reg2.accessToken, 8000);
    expect(status2).toBe(201);

    // Step 4: Cache should be invalidated (deleted) after DB write
    const cachedAfter = await env.KV.get(cacheKey);
    expect(cachedAfter).toBeNull();

    // Step 5: Ranking should reflect the new score from DB
    const ranking2 = await fetchRanking(accessToken, seedId);
    expect(ranking2.ranking).toHaveLength(2);
    expect(ranking2.ranking[0].score).toBe(8000);
    expect(ranking2.ranking[1].score).toBe(3000);
  });

  it('better score (upsert) invalidates ranking cache', async () => {
    // Step 1: Submit initial score
    await submitSprintScore(accessToken, 2000);
    const seedId = await getTodaySeedId(accessToken);

    // Step 2: Populate cache
    await fetchRanking(accessToken, seedId);
    const cacheKey = `ranking:${seedId}:sprint`;
    const cachedBefore = await env.KV.get(cacheKey);
    expect(cachedBefore).not.toBeNull();

    // Step 3: Submit a better score (triggers UPDATE)
    const { status } = await submitSprintScore(accessToken, 9000);
    expect(status).toBe(201);

    // Step 4: Cache should be invalidated
    const cachedAfter = await env.KV.get(cacheKey);
    expect(cachedAfter).toBeNull();

    // Step 5: Ranking reflects updated score
    const ranking = await fetchRanking(accessToken, seedId);
    expect(ranking.ranking).toHaveLength(1);
    expect(ranking.ranking[0].score).toBe(9000);
  });

  it('non-improving score does NOT invalidate ranking cache', async () => {
    // Step 1: Submit a high score first
    await submitSprintScore(accessToken, 9000);
    const seedId = await getTodaySeedId(accessToken);

    // Step 2: Populate cache by fetching ranking
    await fetchRanking(accessToken, seedId);
    const cacheKey = `ranking:${seedId}:sprint`;
    const cachedBefore = await env.KV.get(cacheKey);
    expect(cachedBefore).not.toBeNull();

    // Step 3: Submit a worse score (should NOT modify DB)
    const { status } = await submitSprintScore(accessToken, 1000);
    expect(status).toBe(201);

    // Step 4: Cache should still exist (dbModified = false)
    const cachedAfter = await env.KV.get(cacheKey);
    expect(cachedAfter).not.toBeNull();

    // Step 5: Ranking still shows the original high score
    const ranking = await fetchRanking(accessToken, seedId);
    expect(ranking.ranking).toHaveLength(1);
    expect(ranking.ranking[0].score).toBe(9000);
  });

  it('cache invalidation works correctly across multiple modes', async () => {
    const today = todayJST();

    // Submit sprint score
    await submitSprintScore(accessToken, 5000);
    const seedId = await getTodaySeedId(accessToken);

    // Submit survival score
    await SELF.fetch('http://localhost/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(accessToken) },
      body: JSON.stringify({
        date: today,
        mode: 'survival',
        moveCount: 20,
        score: 4000,
        isCleared: false,
        replayLog: [],
      }),
    });

    // Populate caches for both modes
    await fetchRanking(accessToken, seedId, 'sprint');
    await fetchRanking(accessToken, seedId, 'survival');

    const sprintCacheKey = `ranking:${seedId}:sprint`;
    const survivalCacheKey = `ranking:${seedId}:survival`;
    expect(await env.KV.get(sprintCacheKey)).not.toBeNull();
    expect(await env.KV.get(survivalCacheKey)).not.toBeNull();

    // Submit a better sprint score
    await submitSprintScore(accessToken, 9999);

    // Sprint cache should be invalidated, survival cache should remain
    expect(await env.KV.get(sprintCacheKey)).toBeNull();
    expect(await env.KV.get(survivalCacheKey)).not.toBeNull();
  });

  it('score response still includes achievements even after cache separation', async () => {
    // Verify the response structure is intact after separating
    // evaluateAchievements from KV.delete
    const { status, data } = await submitSprintScore(accessToken, 5000);
    expect(status).toBe(201);
    expect(data).toHaveProperty('scoreId');
    expect(data).toHaveProperty('shareCode');
    expect(data).toHaveProperty('newAchievements');
    expect(Array.isArray(data.newAchievements)).toBe(true);
    expect(data).toHaveProperty('verifiedScore');
    expect(data).toHaveProperty('verifiedMoveCount');
  });

  it('ranking reflects latest data after cache invalidation from concurrent users', async () => {
    // User 1 submits
    await submitSprintScore(accessToken, 3000);
    const seedId = await getTodaySeedId(accessToken);

    // Populate cache
    await fetchRanking(accessToken, seedId);

    // Users 2 and 3 submit scores
    const reg2 = await registerUser('550e8400-e29b-41d4-a716-446655440052');
    const reg3 = await registerUser('550e8400-e29b-41d4-a716-446655440053');

    await submitSprintScore(reg2.accessToken, 7000);
    await submitSprintScore(reg3.accessToken, 5000);

    // After both submissions, cache should have been invalidated
    const cacheKey = `ranking:${seedId}:sprint`;
    expect(await env.KV.get(cacheKey)).toBeNull();

    // Ranking should show all 3 users in correct order
    const ranking = await fetchRanking(accessToken, seedId);
    expect(ranking.ranking).toHaveLength(3);
    expect(ranking.ranking[0].score).toBe(7000);
    expect(ranking.ranking[1].score).toBe(5000);
    expect(ranking.ranking[2].score).toBe(3000);
  });

  it('clear mode: non-cleared score does not invalidate cache when cleared exists', async () => {
    const today = todayJST();

    // Submit a cleared score
    await SELF.fetch('http://localhost/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(accessToken) },
      body: JSON.stringify({
        date: today,
        mode: 'clear',
        moveCount: 10,
        score: 3000,
        isCleared: true,
        replayLog: [],
      }),
    });

    const seedId = await getTodaySeedId(accessToken);

    // Populate cache
    await fetchRanking(accessToken, seedId, 'clear');
    const cacheKey = `ranking:${seedId}:clear`;
    expect(await env.KV.get(cacheKey)).not.toBeNull();

    // Submit a non-cleared score (should NOT replace cleared record -> dbModified = false)
    await SELF.fetch('http://localhost/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(accessToken) },
      body: JSON.stringify({
        date: today,
        mode: 'clear',
        moveCount: 5,
        score: 500,
        isCleared: false,
        replayLog: [],
      }),
    });

    // Cache should still exist since the non-cleared score didn't modify DB
    expect(await env.KV.get(cacheKey)).not.toBeNull();
  });
});
