import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { call, registerUser, authHeader, submitScore, submitReplay } from './helpers';
import { rankingCacheKey } from '../../src/worker/lib/ranking-rule';
import { todayJST } from '../../src/worker/lib/date';

describe('Input validation', () => {
  let accessToken: string;
  let userId: string;

  beforeEach(async () => {
    ({ accessToken, userId } = await registerUser());
  });

  function postUnlock(body: string) {
    return call('http://localhost/api/achievements/unlock', {
      method: 'POST',
      headers: { ...authHeader(accessToken), 'Content-Type': 'application/json' },
      body,
    });
  }

  describe('POST /api/achievements/unlock', () => {
    it('returns 400 for malformed JSON instead of 500', async () => {
      const res = await postUnlock('{not json');
      expect(res.status).toBe(400);
    });

    it.each(['clear_first', 'cascade_chain_3', 'sprint_score_5000', 'all_modes_played'])(
      'rejects achievement type %s, which is not client-unlockable', async (type) => {
        const res = await postUnlock(JSON.stringify({ type }));
        expect(res.status).toBe(400);
      },
    );

    it('still unlocks a client-unlockable achievement', async () => {
      const res = await postUnlock(JSON.stringify({ type: 'tutorial_complete' }));
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/achievements', () => {
    it('does not return rows of removed achievements left in D1', async () => {
      for (const type of ['sprint_score_500', 'all_modes_played', 'cascade_chain_3']) {
        await env.DB.prepare(
          `INSERT INTO achievements (id, user_id, achievement_type, current_value, is_unlocked, unlocked_at)
           VALUES (?, ?, ?, 999, 1, datetime('now'))`
        ).bind(crypto.randomUUID(), userId, type).run();
      }

      const res = await call('http://localhost/api/achievements', { headers: authHeader(accessToken) });
      const { achievements } = await res.json() as { achievements: Array<{ type: string; isUnlocked: boolean }> };
      const types = achievements.map(a => a.type);
      expect(types).not.toContain('sprint_score_500');
      expect(types).not.toContain('all_modes_played');
      expect(types.filter(t => /sprint|survival|cascade_cp/.test(t))).toEqual([]);
      // Kept achievements still show their stored state
      expect(achievements.find(a => a.type === 'cascade_chain_3')?.isUnlocked).toBe(true);
    });
  });

  describe('本文の読み込み（lib/http.ts readJsonBody）', () => {
    it('Content-Type が JSON でない本文は、中身が正しくても invalid_request の 400', async () => {
      const res = await call('http://localhost/api/achievements/unlock', {
        method: 'POST',
        headers: authHeader(accessToken),
        body: JSON.stringify({ type: 'tutorial_complete' }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_request' });
    });

    it('引数付きの JSON の Content-Type は受け付ける', async () => {
      const res = await call('http://localhost/api/achievements/unlock', {
        method: 'POST',
        headers: { ...authHeader(accessToken), 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ type: 'tutorial_complete' }),
      });
      expect(res.status).toBe(200);
    });

    it('上限を超えるスコアの本文は payload_too_large の 413', async () => {
      const res = await submitScore(accessToken, { date: todayJST(), mode: 'clear', padding: 'x'.repeat(300 * 1024) });
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: 'payload_too_large' });
    });

    it('長さの無い本文も、読みながら数えて 413 にする', async () => {
      const bytes = new TextEncoder().encode(JSON.stringify({ padding: 'x'.repeat(300 * 1024) }));
      const body = new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
      const res = await call('http://localhost/api/scores', {
        method: 'POST',
        headers: { ...authHeader(accessToken), 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' },
        body,
        duplex: 'half',
      } as RequestInit);
      expect(res.status).toBe(413);
    });
  });

  describe('POST /api/scores の値の境界（zod と同じ規則）', () => {
    it.each([
      ['安全な整数を超える clearTimeMs', { clearTimeMs: 1e20 }],
      ['null の generatedItemTypes', { generatedItemTypes: null }],
      ['21 文字の generatedItemTypes の要素', { generatedItemTypes: ['x'.repeat(21)] }],
      ['11 件の generatedItemTypes', { generatedItemTypes: Array.from({ length: 11 }, () => 'flush') }],
    ])('%s は 400', async (_label, extra) => {
      const { res } = await submitReplay(accessToken, 1, extra);
      expect(res.status).toBe(400);
    });

    it('24 時間を超える clearTimeMs は時間なしで受け付ける', async () => {
      const { res } = await submitReplay(accessToken, 1, { clearTimeMs: 25 * 60 * 60 * 1000 });
      expect(res.status).toBe(201);
    });
  });

  describe('ルートの照合（src/worker/router.ts）', () => {
    it('無い API は、ID を確かめてから not_found の 404', async () => {
      const unauthenticated = await call('http://localhost/api/nope');
      expect(unauthenticated.status).toBe(401);
      const res = await call('http://localhost/api/nope', { headers: authHeader(accessToken) });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    });

    it('末尾のスラッシュと違うメソッドは一致させない', async () => {
      const slash = await call('http://localhost/api/achievements/', { headers: authHeader(accessToken) });
      expect(slash.status).toBe(404);
      const method = await call('http://localhost/api/achievements', {
        method: 'POST',
        headers: { ...authHeader(accessToken), 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(method.status).toBe(404);
    });

    it('HEAD は GET と同じ応答で、本文を返さない', async () => {
      const res = await call('http://localhost/api/health', { method: 'HEAD' });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('');
    });

    it('パスの引数はデコードし、デコードできなければそのまま渡す', async () => {
      const decoded = await call('http://localhost/api/seeds/by-code/%41BC', { headers: authHeader(accessToken) });
      expect(decoded.status).toBe(404);
      const broken = await call('http://localhost/api/seeds/by-code/%E0%A4%A', { headers: authHeader(accessToken) });
      expect(broken.status).toBe(404);
      expect(await broken.json()).toEqual({ error: 'not_found' });
    });
  });

  describe('GET /api/rankings/:seedId', () => {
    it('returns an empty ranking for an unknown seed without caching it', async () => {
      const seedId = 'does-not-exist-xyz';
      const res = await call(`http://localhost/api/rankings/${seedId}`, {
        headers: authHeader(accessToken),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ranking: [], userRank: null });
      expect(await env.KV.get(rankingCacheKey(seedId))).toBeNull();
    });
  });
});
