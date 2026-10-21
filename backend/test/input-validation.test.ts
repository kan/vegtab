import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { call, registerUser, authHeader } from './helpers';
import { rankingCacheKey } from '../src/lib/ranking-rule';

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
