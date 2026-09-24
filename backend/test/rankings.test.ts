import { describe, it, expect, beforeEach } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { resetDb, registerUser, authHeader, getTodaySeedId, insertPlayScore } from './helpers';
import type { GameMode } from '@vegtab/engine';

interface RankingResponse {
  ranking: Array<{ rank: number; userId: string; score: number; moveCount: number; cascadePoints?: number }>;
  userRank: { rank: number; score: number } | null;
}

describe('Rankings: 同点の順位と、スコア 0 のユーザー', () => {
  const users: Array<{ userId: string; accessToken: string }> = [];
  let seedId: string;

  beforeEach(async () => {
    await resetDb();
    users.length = 0;
    for (let i = 0; i < 4; i++) {
      users.push(await registerUser(`550e8400-e29b-41d4-a716-44665544010${i}`));
    }
    seedId = await getTodaySeedId(users[0].accessToken);
  });

  async function fetchRanking(token: string, mode: GameMode): Promise<RankingResponse> {
    const res = await SELF.fetch(`http://localhost/api/rankings/${seedId}?mode=${mode}`, { headers: authHeader(token) });
    return res.json() as Promise<RankingResponse>;
  }

  /** 一覧の順位と、各ユーザーの userRank がどちらも expected（userId → 順位）に一致することを確かめる */
  async function expectRanks(mode: GameMode, expected: Record<string, number>) {
    for (const u of users) {
      if (!(u.userId in expected)) continue;
      const data = await fetchRanking(u.accessToken, mode);
      const listed = Object.fromEntries(data.ranking.map(e => [e.userId, e.rank]));
      expect(listed).toEqual(expected);
      expect(data.userRank?.rank).toBe(expected[u.userId]);
    }
  }

  it('Sprint: 同じスコアは同順位になり、次の順位は人数分とばす', async () => {
    const [a, b, c] = users;
    await insertPlayScore({ userId: a.userId, seedId, mode: 'sprint', moveCount: 15, score: 500 });
    await insertPlayScore({ userId: b.userId, seedId, mode: 'sprint', moveCount: 15, score: 500 });
    await insertPlayScore({ userId: c.userId, seedId, mode: 'sprint', moveCount: 15, score: 300 });
    await expectRanks('sprint', { [a.userId]: 1, [b.userId]: 1, [c.userId]: 3 });
  });

  it('Clear: 手数もスコアも同じなら同順位、手数が同じでもスコアが高ければ上位', async () => {
    const [a, b, c, d] = users;
    await insertPlayScore({ userId: a.userId, seedId, mode: 'clear', moveCount: 10, score: 200, isCleared: true });
    await insertPlayScore({ userId: b.userId, seedId, mode: 'clear', moveCount: 10, score: 200, isCleared: true });
    await insertPlayScore({ userId: c.userId, seedId, mode: 'clear', moveCount: 10, score: 300, isCleared: true });
    await insertPlayScore({ userId: d.userId, seedId, mode: 'clear', moveCount: 12, score: 900, isCleared: true });
    await expectRanks('clear', { [c.userId]: 1, [a.userId]: 2, [b.userId]: 2, [d.userId]: 4 });
  });

  it('Survival: 手数とスコアが同じなら同順位', async () => {
    const [a, b, c] = users;
    await insertPlayScore({ userId: a.userId, seedId, mode: 'survival', moveCount: 20, score: 100 });
    await insertPlayScore({ userId: b.userId, seedId, mode: 'survival', moveCount: 20, score: 100 });
    await insertPlayScore({ userId: c.userId, seedId, mode: 'survival', moveCount: 25, score: 50 });
    await expectRanks('survival', { [c.userId]: 1, [a.userId]: 2, [b.userId]: 2 });
  });

  it('Cascade: CP とスコアが同じなら同順位', async () => {
    const [a, b, c] = users;
    await insertPlayScore({ userId: a.userId, seedId, mode: 'cascade', moveCount: 15, score: 100, cascadePoints: 40 });
    await insertPlayScore({ userId: b.userId, seedId, mode: 'cascade', moveCount: 15, score: 100, cascadePoints: 40 });
    await insertPlayScore({ userId: c.userId, seedId, mode: 'cascade', moveCount: 15, score: 100, cascadePoints: 10 });
    await expectRanks('cascade', { [a.userId]: 1, [b.userId]: 1, [c.userId]: 3 });
  });

  it('スコア 0 のユーザーにも userRank を返す', async () => {
    const [a, b] = users;
    await insertPlayScore({ userId: a.userId, seedId, mode: 'sprint', moveCount: 15, score: 100 });
    await insertPlayScore({ userId: b.userId, seedId, mode: 'sprint', moveCount: 3, score: 0 });
    const data = await fetchRanking(b.accessToken, 'sprint');
    expect(data.userRank).toEqual({ rank: 2, score: 0 });
  });

  it('キャッシュから返すときも同じ順位になる', async () => {
    const [a, b, c] = users;
    await insertPlayScore({ userId: a.userId, seedId, mode: 'sprint', moveCount: 15, score: 500 });
    await insertPlayScore({ userId: b.userId, seedId, mode: 'sprint', moveCount: 15, score: 500 });
    await insertPlayScore({ userId: c.userId, seedId, mode: 'sprint', moveCount: 15, score: 300 });
    await fetchRanking(a.accessToken, 'sprint'); // キャッシュを作る
    expect(await env.KV.get(`ranking:${seedId}:sprint`)).not.toBeNull();
    await expectRanks('sprint', { [a.userId]: 1, [b.userId]: 1, [c.userId]: 3 });
  });
});

describe('Share: OGP の説明文', () => {
  beforeEach(resetDb);

  it('Clear はクリアした記録の最少手数、Cascade は最高 CP を表示する', async () => {
    const a = await registerUser('550e8400-e29b-41d4-a716-446655440110');
    const b = await registerUser('550e8400-e29b-41d4-a716-446655440111');
    const seedId = await getTodaySeedId(a.accessToken);
    await insertPlayScore({ userId: a.userId, seedId, mode: 'clear', moveCount: 12, score: 300, isCleared: true });
    await insertPlayScore({ userId: b.userId, seedId, mode: 'clear', moveCount: 40, score: 900, isCleared: false });
    await insertPlayScore({ userId: a.userId, seedId, mode: 'cascade', moveCount: 15, score: 900, cascadePoints: 35 });
    await insertPlayScore({ userId: b.userId, seedId, mode: 'cascade', moveCount: 15, score: 1200, cascadePoints: 20 });

    const res = await SELF.fetch(`http://localhost/s/${seedId}`, { headers: { 'User-Agent': 'Twitterbot/1.0' } });
    const html = await res.text();
    expect(html).toContain('Clear: 12 moves');
    expect(html).toContain('Cascade: 35 CP');
  });

  it('クリアした記録がなければ Clear を表示しない', async () => {
    const a = await registerUser('550e8400-e29b-41d4-a716-446655440112');
    const seedId = await getTodaySeedId(a.accessToken);
    await insertPlayScore({ userId: a.userId, seedId, mode: 'clear', moveCount: 40, score: 900, isCleared: false });

    const res = await SELF.fetch(`http://localhost/s/${seedId}`, { headers: { 'User-Agent': 'Twitterbot/1.0' } });
    expect(await res.text()).not.toContain('Clear:');
  });
});
