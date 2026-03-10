import { describe, it, expect, beforeEach } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { applyMigrations, registerUser, authHeader } from './helpers';

/** Helper: get today's date as YYYY-MM-DD in UTC */
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

describe('Seeds & Ranking API', () => {
  let accessToken: string;
  let userId: string;

  beforeEach(async () => {
    await applyMigrations();
    const reg = await registerUser('550e8400-e29b-41d4-a716-446655440020');
    accessToken = reg.accessToken;
    userId = reg.userId;
  });

  it('gets daily seed (auto-creates if missing)', async () => {
    const res = await SELF.fetch('http://localhost/api/seeds/daily', {
      headers: authHeader(accessToken),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { seedId: string; date: string; shareCode: string };
    expect(data.seedId).toBeTruthy();
    expect(data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.shareCode).toHaveLength(6);
  });

  it('seed info returns best scores', async () => {
    // Create seed via daily endpoint
    const dailyRes = await SELF.fetch('http://localhost/api/seeds/daily', {
      headers: authHeader(accessToken),
    });
    const { seedId } = await dailyRes.json() as { seedId: string };

    const infoRes = await SELF.fetch(`http://localhost/api/seeds/${seedId}`, {
      headers: authHeader(accessToken),
    });
    const info = await infoRes.json() as { seedId: string; bestScores: Record<string, number> };
    expect(info.seedId).toBe(seedId);
    expect(info.bestScores).toEqual({});
  });

  it('score submission creates seed and returns shareCode', async () => {
    const today = todayUTC();
    const res = await SELF.fetch('http://localhost/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(accessToken) },
      body: JSON.stringify({
        date: today,
        mode: 'sprint',
        moveLimit: 15,
        moveCount: 15,
        score: 5000,
        isCleared: true,
        replayLog: [],
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json() as { scoreId: string; shareCode: string };
    expect(data.scoreId).toBeTruthy();
    expect(data.shareCode).toHaveLength(6);
  });

  it('rejects score for invalid date', async () => {
    const res = await SELF.fetch('http://localhost/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(accessToken) },
      body: JSON.stringify({
        date: '2020-01-01',
        mode: 'sprint',
        moveLimit: 15,
        moveCount: 15,
        score: 5000,
        isCleared: true,
        replayLog: [],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('sprint ranking returns correct data', async () => {
    const today = todayUTC();

    // Submit a score (auto-creates daily seed)
    await SELF.fetch('http://localhost/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(accessToken) },
      body: JSON.stringify({
        date: today,
        mode: 'sprint',
        moveLimit: 15,
        moveCount: 15,
        score: 5000,
        isCleared: true,
        replayLog: [],
      }),
    });

    // Get seedId from daily endpoint
    const dailyRes = await SELF.fetch('http://localhost/api/seeds/daily', {
      headers: authHeader(accessToken),
    });
    const { seedId } = await dailyRes.json() as { seedId: string };

    // Check ranking
    const rankRes = await SELF.fetch(`http://localhost/api/rankings/${seedId}?mode=sprint`, {
      headers: authHeader(accessToken),
    });
    expect(rankRes.status).toBe(200);
    const rankData = await rankRes.json() as {
      ranking: Array<{ rank: number; score: number }>;
      userRank: { rank: number; score: number } | null;
    };
    expect(rankData.ranking).toHaveLength(1);
    expect(rankData.ranking[0].score).toBe(5000);
    expect(rankData.userRank?.rank).toBe(1);
    expect(rankData.userRank?.score).toBe(5000);
  });

  it('clear mode ranking sorted by move_count ASC', async () => {
    const today = todayUTC();

    // Submit clear score (auto-creates daily seed)
    await SELF.fetch('http://localhost/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(accessToken) },
      body: JSON.stringify({
        date: today,
        mode: 'clear',
        moveCount: 20,
        score: 3000,
        isCleared: true,
        replayLog: [],
      }),
    });

    // Submit better clear score (fewer moves — should replace)
    await SELF.fetch('http://localhost/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(accessToken) },
      body: JSON.stringify({
        date: today,
        mode: 'clear',
        moveCount: 12,
        score: 2000,
        isCleared: true,
        replayLog: [],
      }),
    });

    // Submit a non-cleared score (should NOT replace cleared record)
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

    // Get seedId
    const dailyRes = await SELF.fetch('http://localhost/api/seeds/daily', {
      headers: authHeader(accessToken),
    });
    const { seedId } = await dailyRes.json() as { seedId: string };

    // Check ranking — should use best (lowest) move_count of cleared plays
    const rankRes = await SELF.fetch(`http://localhost/api/rankings/${seedId}?mode=clear`, {
      headers: authHeader(accessToken),
    });
    expect(rankRes.status).toBe(200);
    const rankData = await rankRes.json() as {
      ranking: Array<{ rank: number; score: number; moveCount: number; isCleared: boolean }>;
      userRank: { rank: number; score: number; moveCount: number } | null;
    };
    expect(rankData.ranking).toHaveLength(1);
    // Best cleared play is 12 moves
    expect(rankData.ranking[0].moveCount).toBe(12);
    expect(rankData.ranking[0].isCleared).toBe(true);
    expect(rankData.userRank?.rank).toBe(1);
    expect(rankData.userRank?.moveCount).toBe(12);
  });

  it('survival mode ranking sorted by move_count DESC then score DESC', async () => {
    const today = todayUTC();

    // Submit score for user 1 (auto-creates daily seed)
    await SELF.fetch('http://localhost/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(accessToken) },
      body: JSON.stringify({
        date: today,
        mode: 'survival',
        moveCount: 30,
        score: 8000,
        isCleared: false,
        replayLog: [],
      }),
    });

    // Register a second user
    const reg2 = await registerUser('550e8400-e29b-41d4-a716-446655440021');

    // User 2: survives 25 moves, score 9000 (fewer moves, so ranked lower)
    await SELF.fetch('http://localhost/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(reg2.accessToken) },
      body: JSON.stringify({
        date: today,
        mode: 'survival',
        moveCount: 25,
        score: 9000,
        isCleared: false,
        replayLog: [],
      }),
    });

    // Get seedId
    const dailyRes = await SELF.fetch('http://localhost/api/seeds/daily', {
      headers: authHeader(accessToken),
    });
    const { seedId } = await dailyRes.json() as { seedId: string };

    // Check ranking
    const rankRes = await SELF.fetch(`http://localhost/api/rankings/${seedId}?mode=survival`, {
      headers: authHeader(accessToken),
    });
    expect(rankRes.status).toBe(200);
    const rankData = await rankRes.json() as {
      ranking: Array<{ rank: number; userId: string; moveCount: number; score: number }>;
      userRank: { rank: number; score: number; moveCount: number } | null;
    };
    expect(rankData.ranking).toHaveLength(2);
    // User 1 (30 moves) should be ranked #1 over User 2 (25 moves)
    expect(rankData.ranking[0].moveCount).toBe(30);
    expect(rankData.ranking[0].score).toBe(8000);
    expect(rankData.ranking[1].moveCount).toBe(25);
    expect(rankData.ranking[1].score).toBe(9000);
    // User 1's rank
    expect(rankData.userRank?.rank).toBe(1);
    expect(rankData.userRank?.moveCount).toBe(30);
  });
});
