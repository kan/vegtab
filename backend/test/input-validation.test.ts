import { describe, it, expect, beforeEach } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { registerUser, authHeader } from './helpers';
import { rankingCacheKey } from '../src/lib/ranking-rule';

// Built from code points so the source file stays plain ASCII
const NUL = String.fromCodePoint(0x0000);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);
const FAMILY_EMOJI = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);

describe('Input validation', () => {
  let accessToken: string;
  let userId: string;

  beforeEach(async () => {
    ({ accessToken, userId } = await registerUser(crypto.randomUUID()));
  });

  function patchDisplayName(displayName: string | null) {
    return SELF.fetch('http://localhost/api/user/profile', {
      method: 'PATCH',
      headers: { ...authHeader(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    });
  }

  function postUnlock(body: string) {
    return SELF.fetch('http://localhost/api/achievements/unlock', {
      method: 'POST',
      headers: { ...authHeader(accessToken), 'Content-Type': 'application/json' },
      body,
    });
  }

  async function storedDisplayName() {
    const row = await env.DB.prepare('SELECT display_name FROM users WHERE id = ?')
      .bind(userId).first<{ display_name: string | null }>();
    return row?.display_name;
  }

  describe('PATCH /api/user/profile', () => {
    it.each([
      ['empty', ''],
      ['whitespace only', '   '],
      ['control character', `a${NUL}b`],
      ['bidi override', `abc${RIGHT_TO_LEFT_OVERRIDE}def`],
      ['too long', 'x'.repeat(21)],
    ])('rejects a %s name', async (_label, name) => {
      const res = await patchDisplayName(name);
      expect(res.status).toBe(400);
    });

    it('trims surrounding whitespace', async () => {
      const res = await patchDisplayName('  Kan  ');
      expect(res.status).toBe(200);
      expect(await storedDisplayName()).toBe('Kan');
    });

    it('accepts emoji sequences joined with zero-width joiners', async () => {
      const res = await patchDisplayName(FAMILY_EMOJI);
      expect(res.status).toBe(200);
      expect(await storedDisplayName()).toBe(FAMILY_EMOJI);
    });

    it('accepts null to clear the name', async () => {
      await patchDisplayName('Kan');
      const res = await patchDisplayName(null);
      expect(res.status).toBe(200);
      expect(await storedDisplayName()).toBeNull();
    });
  });

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

      const res = await SELF.fetch('http://localhost/api/achievements', { headers: authHeader(accessToken) });
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
      const res = await SELF.fetch(`http://localhost/api/rankings/${seedId}`, {
        headers: authHeader(accessToken),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ranking: [], userRank: null });
      expect(await env.KV.get(rankingCacheKey(seedId))).toBeNull();
    });
  });
});
