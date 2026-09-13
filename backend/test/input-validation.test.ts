import { describe, it, expect, beforeEach } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { applyMigrations, registerUser, authHeader } from './helpers';

// Built from code points so the source file stays plain ASCII
const NUL = String.fromCodePoint(0x0000);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);
const FAMILY_EMOJI = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);

describe('Input validation', () => {
  let accessToken: string;
  let userId: string;

  beforeEach(async () => {
    await applyMigrations();
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

    it('rejects achievement types that are not client-unlockable', async () => {
      const res = await postUnlock(JSON.stringify({ type: 'sprint_score_5000' }));
      expect(res.status).toBe(400);
    });

    it('still unlocks a client-unlockable achievement', async () => {
      const res = await postUnlock(JSON.stringify({ type: 'tutorial_complete' }));
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/rankings/:seedId', () => {
    it('returns an empty ranking for an unknown seed without caching it', async () => {
      const seedId = 'does-not-exist-xyz';
      const res = await SELF.fetch(`http://localhost/api/rankings/${seedId}?mode=sprint`, {
        headers: authHeader(accessToken),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ranking: [], userRank: null });
      expect(await env.KV.get(`ranking:${seedId}:sprint`)).toBeNull();
    });
  });
});
