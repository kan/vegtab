import { describe, it, expect, beforeEach } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { resetDb, registerUser, authHeader, getTodaySeedId, insertPlayScore } from './helpers';

interface RankingResponse {
  ranking: Array<{ rank: number; userId: string; score: number; moveCount: number; isCleared: boolean; scoreId?: string }>;
  userRank: { rank: number; score: number; moveCount: number } | null;
}

describe('Rankings: 同点の順位', () => {
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

  async function fetchRanking(token: string): Promise<RankingResponse> {
    const res = await SELF.fetch(`http://localhost/api/rankings/${seedId}`, { headers: authHeader(token) });
    return res.json() as Promise<RankingResponse>;
  }

  /** 一覧の順位と、各ユーザーの userRank がどちらも expected（userId → 順位）に一致することを確かめる */
  async function expectRanks(expected: Record<string, number>) {
    for (const u of users) {
      if (!(u.userId in expected)) continue;
      const data = await fetchRanking(u.accessToken);
      const listed = Object.fromEntries(data.ranking.map(e => [e.userId, e.rank]));
      expect(listed).toEqual(expected);
      expect(data.userRank?.rank).toBe(expected[u.userId]);
    }
  }

  async function insertClearRanks() {
    const [a, b, c, d] = users;
    await insertPlayScore({ userId: a.userId, seedId, moveCount: 10, score: 200, isCleared: true });
    await insertPlayScore({ userId: b.userId, seedId, moveCount: 10, score: 200, isCleared: true });
    await insertPlayScore({ userId: c.userId, seedId, moveCount: 10, score: 300, isCleared: true });
    await insertPlayScore({ userId: d.userId, seedId, moveCount: 12, score: 900, isCleared: true });
    return { [c.userId]: 1, [a.userId]: 2, [b.userId]: 2, [d.userId]: 4 };
  }

  it('手数もスコアも同じなら同順位、手数が同じでもスコアが高ければ上位', async () => {
    await expectRanks(await insertClearRanks());
  });

  it('キャッシュから返すときも同じ順位になる', async () => {
    const expected = await insertClearRanks();
    await fetchRanking(users[0].accessToken); // キャッシュを作る
    expect(await env.KV.get(`ranking:${seedId}:clear`)).not.toBeNull();
    await expectRanks(expected);
  });

  it('エントリと userRank の形（maxChain / cascadePoints を返さない）', async () => {
    const [a] = users;
    await insertPlayScore({ userId: a.userId, seedId, moveCount: 10, score: 200, isCleared: true, maxChain: 5, cascadePoints: 40 });
    for (const pass of ['db', 'cache']) {
      const data = await fetchRanking(a.accessToken);
      expect(data.ranking, pass).toEqual([
        { rank: 1, userId: a.userId, displayName: 'NO NAME', score: 200, moveCount: 10, isCleared: true, scoreId: expect.any(String) },
      ]);
      expect(data.userRank, pass).toEqual({ rank: 1, score: 200, moveCount: 10 });
    }
  });

  it('撤去したモードの行はランキングに出ない', async () => {
    const [a, b, c] = users;
    await insertPlayScore({ userId: a.userId, seedId, moveCount: 10, score: 200, isCleared: true });
    await insertPlayScore({ userId: b.userId, seedId, mode: 'sprint', moveCount: 15, score: 5000, isCleared: true });
    await insertPlayScore({ userId: c.userId, seedId, mode: 'cascade', moveCount: 1, score: 5000, isCleared: true, cascadePoints: 99 });
    const data = await fetchRanking(b.accessToken);
    expect(data.ranking.map(e => e.userId)).toEqual([a.userId]);
    expect(data.userRank).toBeNull();
  });

  it('mode は省略でき、clear 以外は 400', async () => {
    const ok = await SELF.fetch(`http://localhost/api/rankings/${seedId}?mode=clear`, { headers: authHeader(users[0].accessToken) });
    expect(ok.status).toBe(200);
    const paths = [seedId, `by-value/${await seedValue()}`];
    for (const mode of ['sprint', 'survival', 'cascade', 'bogus']) {
      for (const path of paths) {
        const res = await SELF.fetch(`http://localhost/api/rankings/${path}?mode=${mode}`, { headers: authHeader(users[0].accessToken) });
        expect(res.status, `${path} ${mode}`).toBe(400);
      }
    }
  });

  async function seedValue() {
    const row = await env.DB.prepare('SELECT seed_value FROM puzzle_seeds WHERE id = ?').bind(seedId).first<{ seed_value: string }>();
    return row!.seed_value;
  }

  it('by-value も同じランキングを返す', async () => {
    const expected = await insertClearRanks();
    const res = await SELF.fetch(`http://localhost/api/rankings/by-value/${await seedValue()}`, { headers: authHeader(users[0].accessToken) });
    const data = await res.json() as RankingResponse;
    expect(Object.fromEntries(data.ranking.map(e => [e.userId, e.rank]))).toEqual(expected);
  });
});

describe('Share: OGP の説明文', () => {
  beforeEach(resetDb);

  const crawler = { headers: { 'User-Agent': 'Twitterbot/1.0' } };

  it('クリアした記録の最少手数だけを表示し、撤去したモードの記録は出さない', async () => {
    const a = await registerUser('550e8400-e29b-41d4-a716-446655440110');
    const b = await registerUser('550e8400-e29b-41d4-a716-446655440111');
    const seedId = await getTodaySeedId(a.accessToken);
    await insertPlayScore({ userId: a.userId, seedId, moveCount: 12, score: 300, isCleared: true });
    await insertPlayScore({ userId: b.userId, seedId, moveCount: 40, score: 900, isCleared: false });
    // A removed mode's row with fewer moves must not become the shown record
    await insertPlayScore({ userId: b.userId, seedId, mode: 'survival', moveCount: 3, score: 1200, isCleared: true });
    await insertPlayScore({ userId: a.userId, seedId, mode: 'cascade', moveCount: 15, score: 900, cascadePoints: 35 });

    const html = await (await SELF.fetch(`http://localhost/s/${seedId}`, crawler)).text();
    expect(html).toContain('Clear: 12 moves. Can you beat it?');
    expect(html).not.toMatch(/Sprint|Survival|Cascade/);

    const svg = await (await SELF.fetch(`http://localhost/s/${seedId}/ogp.svg`)).text();
    expect(svg).toContain('Clear: 12 moves');
    expect(svg).not.toMatch(/Sprint|Survival|Cascade/);
  });

  it('クリアした記録がなければ Clear を表示しない', async () => {
    const a = await registerUser('550e8400-e29b-41d4-a716-446655440112');
    const seedId = await getTodaySeedId(a.accessToken);
    await insertPlayScore({ userId: a.userId, seedId, moveCount: 40, score: 900, isCleared: false });
    await insertPlayScore({ userId: a.userId, seedId, mode: 'sprint', moveCount: 15, score: 900, isCleared: true });

    const html = await (await SELF.fetch(`http://localhost/s/${seedId}`, crawler)).text();
    expect(html).not.toContain('Clear:');
    expect(html).toContain('Try this puzzle!');
  });

  it('share code でも引ける', async () => {
    const a = await registerUser('550e8400-e29b-41d4-a716-446655440113');
    const seedId = await getTodaySeedId(a.accessToken);
    const { share_code } = (await env.DB.prepare('SELECT share_code FROM puzzle_seeds WHERE id = ?').bind(seedId).first<{ share_code: string }>())!;
    await insertPlayScore({ userId: a.userId, seedId, moveCount: 9, score: 300, isCleared: true });

    const html = await (await SELF.fetch(`http://localhost/s/${share_code.toLowerCase()}`, crawler)).text();
    expect(html).toContain('Clear: 9 moves');
  });
});
