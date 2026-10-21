import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  call, resetDb, registerUser, createLegacyUser, authHeader, idPlatform, getTodaySeedId, insertPlayScore, ORIGIN,
} from './helpers';

const LEGACY = { LEGACY_HOST: 'vegtab.app' };

/** The old screen on vegtab.app asks for a handoff URL with its Bearer token */
async function handoff(accessToken: string) {
  return call('https://vegtab.app/api/legacy/handoff', {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, Origin: 'https://vegtab.app' },
  }, LEGACY);
}

async function handoffToken(accessToken: string): Promise<string> {
  const res = await handoff(accessToken);
  expect(res.status).toBe(200);
  const { url } = await res.json() as { url: string };
  expect(url).toMatch(/^http:\/\/localhost:5173\/#handoff=[A-Za-z0-9_-]{43}$/);
  return url.split('#handoff=')[1];
}

function claim(cookie: string, token: string) {
  return call('http://localhost/api/legacy/claim', {
    method: 'POST',
    headers: { ...authHeader(cookie), 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

async function rowsOf(table: string, column: string, id: string) {
  const { results } = await env.DB.prepare(`SELECT * FROM ${table} WHERE ${column} = ?`).bind(id).all();
  return results;
}

describe('Handing an old vegtab.app account over', () => {
  beforeEach(resetDb);

  it('moves the records and achievements to the ID, registers the old name, and removes the old account', async () => {
    const legacy = await createLegacyUser('Veggie');
    const me = await registerUser();
    const seedId = await getTodaySeedId(me.accessToken);
    await insertPlayScore({ userId: legacy.userId, seedId, moveCount: 9, score: 100, isCleared: true });
    await env.DB.prepare(
      `INSERT INTO achievements (id, user_id, achievement_type, current_value, is_unlocked, unlocked_at)
       VALUES (?, ?, 'clear_first', 1, 1, '2026-09-01T00:00:00.000Z')`
    ).bind(crypto.randomUUID(), legacy.userId).run();

    const res = await claim(me.accessToken, await handoffToken(legacy.accessToken));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'registered' });

    expect(await rowsOf('play_scores', 'user_id', me.userId)).toHaveLength(1);
    expect(await rowsOf('achievements', 'user_id', me.userId)).toMatchObject([{ achievement_type: 'clear_first', is_unlocked: 1 }]);
    expect(idPlatform.names.get(me.userId)).toBe('Veggie');
    expect(await rowsOf('profiles', 'account_id', me.userId)).toMatchObject([{ display_name: 'Veggie' }]);
    for (const table of ['play_scores', 'achievements', 'refresh_token_families', 'legacy_handoffs']) {
      expect(await rowsOf(table, 'user_id', legacy.userId), table).toEqual([]);
    }
    expect(await rowsOf('users', 'id', legacy.userId)).toEqual([]);
    expect(await rowsOf('legacy_claims', 'legacy_user_id', legacy.userId)).toMatchObject([{ account_id: me.userId }]);
  });

  it('keeps the ID\'s own record of a seed and merges the achievements by their better progress', async () => {
    const legacy = await createLegacyUser();
    const me = await registerUser();
    const seedId = await getTodaySeedId(me.accessToken);
    await insertPlayScore({ userId: legacy.userId, seedId, moveCount: 5, score: 100, isCleared: true });
    const ownId = await insertPlayScore({ userId: me.userId, seedId, moveCount: 9, score: 100, isCleared: true });
    const achievement = (userId: string, type: string, value: number, unlocked: number, at: string | null) =>
      env.DB.prepare(
        `INSERT INTO achievements (id, user_id, achievement_type, current_value, is_unlocked, unlocked_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), userId, type, value, unlocked, at).run();
    await achievement(legacy.userId, 'clear_under_7', 5, 1, '2026-09-01T00:00:00.000Z');
    await achievement(me.userId, 'clear_under_7', 9, 0, null);
    await achievement(legacy.userId, 'play_days_7', 3, 0, null);
    await achievement(me.userId, 'play_days_7', 7, 1, '2026-10-21T00:00:00.000Z');

    const res = await claim(me.accessToken, await handoffToken(legacy.accessToken));
    expect(await res.json()).toEqual({ name: 'none' });
    expect(await rowsOf('profiles', 'account_id', me.userId)).toEqual([]);

    expect((await rowsOf('play_scores', 'user_id', me.userId)).map(r => r.id)).toEqual([ownId]);
    const byType = Object.fromEntries((await rowsOf('achievements', 'user_id', me.userId)).map(r => [r.achievement_type, r]));
    expect(byType.clear_under_7).toMatchObject({ current_value: 5, is_unlocked: 1, unlocked_at: '2026-09-01T00:00:00.000Z' });
    expect(byType.play_days_7).toMatchObject({ current_value: 7, is_unlocked: 1, unlocked_at: '2026-10-21T00:00:00.000Z' });
  });

  it('moves the records even when the old name is taken; the player chooses another', async () => {
    idPlatform.setName(crypto.randomUUID(), 'Veggie');
    const legacy = await createLegacyUser('Veggie');
    const me = await registerUser();
    const res = await claim(me.accessToken, await handoffToken(legacy.accessToken));
    expect(await res.json()).toEqual({ name: 'taken' });
    expect(await rowsOf('profiles', 'account_id', me.userId)).toEqual([]);
    expect(await rowsOf('users', 'id', legacy.userId)).toEqual([]);
  });

  it('keeps the name an ID already has, and consents to publish it', async () => {
    const legacy = await createLegacyUser('Veggie');
    const me = await registerUser();
    idPlatform.setName(me.userId, 'FromTako');
    const res = await claim(me.accessToken, await handoffToken(legacy.accessToken));
    expect(await res.json()).toEqual({ name: 'kept' });
    expect(await rowsOf('profiles', 'account_id', me.userId)).toMatchObject([{ display_name: 'FromTako' }]);
  });

  it('can be handed over only once', async () => {
    const legacy = await createLegacyUser();
    const first = await handoffToken(legacy.accessToken);
    const second = await handoffToken(legacy.accessToken);
    const me = await registerUser();
    expect((await claim(me.accessToken, first)).status).toBe(200);

    const other = await registerUser();
    expect((await claim(other.accessToken, first)).status).toBe(400);
    expect((await claim(other.accessToken, second)).status).toBe(400);
    expect((await handoff(legacy.accessToken)).status).toBe(409);
  });

  it('refuses an unknown or expired token, and the handoff without a valid Bearer token', async () => {
    const legacy = await createLegacyUser();
    const token = await handoffToken(legacy.accessToken);
    await env.DB.prepare('UPDATE legacy_handoffs SET expires_at = ?').bind(Date.now() - 1).run();
    const me = await registerUser();
    expect((await claim(me.accessToken, token)).status).toBe(400);
    expect((await claim(me.accessToken, 'x'.repeat(43))).status).toBe(400);
    expect((await handoff('not-a-token')).status).toBe(401);
  });

  it('needs the ID cookie to claim', async () => {
    const legacy = await createLegacyUser();
    const res = await call('http://localhost/api/legacy/claim', {
      method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: await handoffToken(legacy.accessToken) }),
    });
    expect(res.status).toBe(401);
  });
});

describe('The old host', () => {
  it('sends share URLs to the new host and answers 410 to the rest of the API', async () => {
    const share = await call('https://vegtab.app/s/ABC123?x=1', {}, LEGACY);
    expect(share.status).toBe(301);
    expect(share.headers.get('Location')).toBe('http://localhost:5173/s/ABC123?x=1');

    const api = await call('https://vegtab.app/api/seeds/daily', {}, LEGACY);
    expect(api.status).toBe(410);
    expect(await api.json()).toEqual({ error: 'moved', url: 'http://localhost:5173' });

    expect((await call('https://vegtab.app/api/health', {}, LEGACY)).status).toBe(200);
  });
});
