import { describe, it, expect, beforeEach } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { applyMigrations, registerUser, authHeader } from './helpers';

describe('Seeds & Ranking API', () => {
  let accessToken: string;
  let userId: string;

  beforeEach(async () => {
    await applyMigrations();
    const reg = await registerUser('550e8400-e29b-41d4-a716-446655440020');
    accessToken = reg.accessToken;
    userId = reg.userId;
  });

  it('generates a new seed', async () => {
    const res = await SELF.fetch('http://localhost/api/seeds/generate', {
      method: 'POST',
      headers: authHeader(accessToken),
    });
    expect(res.status).toBe(201);
    const data = await res.json() as { seedId: string; seedValue: string; shareCode: string };
    expect(data.seedId).toBeTruthy();
    expect(data.shareCode).toHaveLength(6);
  });

  it('gets daily seed (auto-creates if missing)', async () => {
    const res = await SELF.fetch('http://localhost/api/seeds/daily', {
      headers: authHeader(accessToken),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { seedId: string; date: string };
    expect(data.seedId).toBeTruthy();
    expect(data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('seed info returns best scores', async () => {
    const genRes = await SELF.fetch('http://localhost/api/seeds/generate', {
      method: 'POST',
      headers: authHeader(accessToken),
    });
    const { seedId } = await genRes.json() as { seedId: string };

    const infoRes = await SELF.fetch(`http://localhost/api/seeds/${seedId}`, {
      headers: authHeader(accessToken),
    });
    const info = await infoRes.json() as { seedId: string; bestScores: Record<string, number> };
    expect(info.seedId).toBe(seedId);
    expect(info.bestScores).toEqual({});
  });

  it('ranking returns correct data', async () => {
    // Generate seed
    const genRes = await SELF.fetch('http://localhost/api/seeds/generate', {
      method: 'POST',
      headers: authHeader(accessToken),
    });
    const { seedId } = await genRes.json() as { seedId: string };

    // Submit a score
    await SELF.fetch('http://localhost/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(accessToken) },
      body: JSON.stringify({
        seedId,
        mode: 'limited',
        moveLimit: 15,
        moveCount: 15,
        score: 5000,
        isCleared: true,
        replayLog: [],
      }),
    });

    // Check ranking
    const rankRes = await SELF.fetch(`http://localhost/api/rankings/${seedId}?mode=limited`, {
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
});
