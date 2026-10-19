import { describe, it, expect, beforeEach } from 'vitest';
import { SELF } from 'cloudflare:test';
import {
  registerUser, authHeader, submitReplay, getTodaySeedId, insertPlayScore,
} from './helpers';

describe('Seeds & Ranking API', () => {
  let accessToken: string;
  let userId: string;

  beforeEach(async () => {
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
    const seedId = await getTodaySeedId(accessToken);

    const infoRes = await SELF.fetch(`http://localhost/api/seeds/${seedId}`, {
      headers: authHeader(accessToken),
    });
    const info = await infoRes.json() as { seedId: string; bestScores: Record<string, number> };
    expect(info.seedId).toBe(seedId);
    expect(info.bestScores).toEqual({});
  });

  it('score submission creates seed and returns shareCode', async () => {
    const { res } = await submitReplay(accessToken, 'sprint', 1);
    expect(res.status).toBe(201);
    const data = await res.json() as { scoreId: string; shareCode: string };
    expect(data.scoreId).toBeTruthy();
    expect(data.shareCode).toHaveLength(6);
  });

  it('rejects score for invalid date', async () => {
    const { res } = await submitReplay(accessToken, 'sprint', 1, { date: '2020-01-01' });
    expect(res.status).toBe(400);
  });

  it('sprint ranking returns correct data', async () => {
    // Submit a score (auto-creates daily seed)
    const { state } = await submitReplay(accessToken, 'sprint', 2);
    const seedId = await getTodaySeedId(accessToken);

    const rankRes = await SELF.fetch(`http://localhost/api/rankings/${seedId}?mode=sprint`, {
      headers: authHeader(accessToken),
    });
    expect(rankRes.status).toBe(200);
    const rankData = await rankRes.json() as {
      ranking: Array<{ rank: number; score: number }>;
      userRank: { rank: number; score: number } | null;
    };
    expect(rankData.ranking).toHaveLength(1);
    expect(rankData.ranking[0].score).toBe(state.score);
    expect(rankData.userRank?.rank).toBe(1);
    expect(rankData.userRank?.score).toBe(state.score);
  });

  it('clear mode ranking uses the fewest moves among cleared plays', async () => {
    // Cleared plays cannot be produced by short replays, so the rows are inserted directly
    // (one row per user and seed×mode, so the other results belong to other users)
    const seedId = await getTodaySeedId(accessToken);
    const slower = await registerUser(crypto.randomUUID());
    const notCleared = await registerUser(crypto.randomUUID());
    await insertPlayScore({ userId: slower.userId, seedId, mode: 'clear', moveCount: 20, score: 3000, isCleared: true });
    await insertPlayScore({ userId, seedId, mode: 'clear', moveCount: 12, score: 2000, isCleared: true });
    await insertPlayScore({ userId: notCleared.userId, seedId, mode: 'clear', moveCount: 5, score: 500, isCleared: false });

    const rankRes = await SELF.fetch(`http://localhost/api/rankings/${seedId}?mode=clear`, {
      headers: authHeader(accessToken),
    });
    expect(rankRes.status).toBe(200);
    const rankData = await rankRes.json() as {
      ranking: Array<{ rank: number; score: number; moveCount: number; isCleared: boolean }>;
      userRank: { rank: number; score: number; moveCount: number } | null;
    };
    // Uncleared plays are not ranked; fewest moves first
    expect(rankData.ranking.map(e => e.moveCount)).toEqual([12, 20]);
    expect(rankData.ranking[0].isCleared).toBe(true);
    expect(rankData.userRank?.rank).toBe(1);
    expect(rankData.userRank?.moveCount).toBe(12);
  });

  it('survival mode ranking sorted by move_count DESC then score DESC', async () => {
    const seedId = await getTodaySeedId(accessToken);
    const reg2 = await registerUser('550e8400-e29b-41d4-a716-446655440021');

    // User 1 survives 30 moves; user 2 survives 25 moves with a higher score (ranked lower)
    await insertPlayScore({ userId, seedId, mode: 'survival', moveCount: 30, score: 8000 });
    await insertPlayScore({ userId: reg2.userId, seedId, mode: 'survival', moveCount: 25, score: 9000 });

    const rankRes = await SELF.fetch(`http://localhost/api/rankings/${seedId}?mode=survival`, {
      headers: authHeader(accessToken),
    });
    expect(rankRes.status).toBe(200);
    const rankData = await rankRes.json() as {
      ranking: Array<{ rank: number; userId: string; moveCount: number; score: number }>;
      userRank: { rank: number; score: number; moveCount: number } | null;
    };
    expect(rankData.ranking).toHaveLength(2);
    expect(rankData.ranking[0].moveCount).toBe(30);
    expect(rankData.ranking[0].score).toBe(8000);
    expect(rankData.ranking[1].moveCount).toBe(25);
    expect(rankData.ranking[1].score).toBe(9000);
    expect(rankData.userRank?.rank).toBe(1);
    expect(rankData.userRank?.moveCount).toBe(30);
  });
});
