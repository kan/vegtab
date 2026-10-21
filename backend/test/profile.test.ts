import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  call, resetDb, registerUser, authHeader, idPlatform, getTodaySeedId, insertPlayScore,
} from './helpers';
import { rankingCacheKey } from '../src/lib/ranking-rule';

function postProfile(cookie: string, body: unknown) {
  return call('http://localhost/api/user/profile', {
    method: 'POST',
    headers: { ...authHeader(cookie), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function storedProfile(accountId: string) {
  return env.DB.prepare('SELECT display_name FROM profiles WHERE account_id = ?')
    .bind(accountId).first<{ display_name: string }>();
}

describe('POST /api/user/profile', () => {
  beforeEach(resetDb);

  it('registers the name on kan-game.app and stores it with the consent', async () => {
    const { userId, accessToken } = await registerUser();
    const res = await postProfile(accessToken, { displayName: '  Kan  ', consent: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ displayName: 'Kan' });
    expect(idPlatform.names.get(userId)).toBe('Kan');
    expect((await storedProfile(userId))?.display_name).toBe('Kan');

    const got = await call('http://localhost/api/user/profile', { headers: authHeader(accessToken) });
    expect(await got.json()).toEqual({ displayName: 'Kan' });
  });

  it('requires the consent', async () => {
    const { userId, accessToken } = await registerUser();
    expect((await postProfile(accessToken, { displayName: 'Kan' })).status).toBe(400);
    expect((await postProfile(accessToken, { displayName: 'Kan', consent: false })).status).toBe(400);
    expect(idPlatform.names.has(userId)).toBe(false);
  });

  it('answers 409 for a name another ID holds, and 400 for a name against the rules', async () => {
    idPlatform.setName(crypto.randomUUID(), 'Taken');
    const { userId, accessToken } = await registerUser();
    const taken = await postProfile(accessToken, { displayName: 'Taken', consent: true });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: 'name_taken' });
    const invalid = await postProfile(accessToken, { displayName: 'x', consent: true });
    expect(invalid.status).toBe(400);
    expect(await storedProfile(userId)).toBeNull();
  });

  it('keeps the name an ID already has (from another game): only the consent is added', async () => {
    const { userId, accessToken } = await registerUser();
    idPlatform.setName(userId, 'FromTako');
    const res = await postProfile(accessToken, { displayName: 'Other', consent: true });
    expect(await res.json()).toEqual({ displayName: 'FromTako' });
    expect((await storedProfile(userId))?.display_name).toBe('FromTako');
  });

  it('drops the ranking caches of the seeds the ID has records of', async () => {
    const { userId, accessToken } = await registerUser();
    const seedId = await getTodaySeedId(accessToken);
    await insertPlayScore({ userId, seedId, moveCount: 9, score: 100, isCleared: true });
    await env.KV.put(rankingCacheKey(seedId), JSON.stringify({ entries: [] }));

    await postProfile(accessToken, { displayName: 'Kan', consent: true });
    expect(await env.KV.get(rankingCacheKey(seedId))).toBeNull();
  });
});
