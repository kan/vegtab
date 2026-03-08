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

  it('unlocks a seed consuming stamina', async () => {
    // Generate seed
    const genRes = await SELF.fetch('http://localhost/api/seeds/generate', {
      method: 'POST',
      headers: authHeader(accessToken),
    });
    const { seedId } = await genRes.json() as { seedId: string };

    // Unlock
    const unlockRes = await SELF.fetch(`http://localhost/api/seeds/${seedId}/unlock`, {
      method: 'POST',
      headers: authHeader(accessToken),
    });
    expect(unlockRes.status).toBe(200);
    const data = await unlockRes.json() as { remainingStamina: number };
    expect(data.remainingStamina).toBe(4);

    // Double unlock should fail
    const res2 = await SELF.fetch(`http://localhost/api/seeds/${seedId}/unlock`, {
      method: 'POST',
      headers: authHeader(accessToken),
    });
    expect(res2.status).toBe(400);
  });

  it('seed status transitions correctly', async () => {
    const genRes = await SELF.fetch('http://localhost/api/seeds/generate', {
      method: 'POST',
      headers: authHeader(accessToken),
    });
    const { seedId } = await genRes.json() as { seedId: string };

    // Before unlock: trial_available (for own seeds too, since not unlocked yet)
    const infoRes1 = await SELF.fetch(`http://localhost/api/seeds/${seedId}`, {
      headers: authHeader(accessToken),
    });
    const info1 = await infoRes1.json() as { status: string };
    expect(info1.status).toBe('trial_available');

    // After unlock
    await SELF.fetch(`http://localhost/api/seeds/${seedId}/unlock`, {
      method: 'POST',
      headers: authHeader(accessToken),
    });

    const infoRes2 = await SELF.fetch(`http://localhost/api/seeds/${seedId}`, {
      headers: authHeader(accessToken),
    });
    const info2 = await infoRes2.json() as { status: string };
    expect(info2.status).toBe('unlocked');
  });

  it('ranking returns correct data', async () => {
    // Generate and unlock seed
    const genRes = await SELF.fetch('http://localhost/api/seeds/generate', {
      method: 'POST',
      headers: authHeader(accessToken),
    });
    const { seedId } = await genRes.json() as { seedId: string };

    await SELF.fetch(`http://localhost/api/seeds/${seedId}/unlock`, {
      method: 'POST',
      headers: authHeader(accessToken),
    });

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
        usedBroughtItems: false,
        usedUndo: false,
        isTrial: false,
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
