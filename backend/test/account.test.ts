import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  call, resetDb, registerUser, authHeader, testEnv, getTodaySeedId, insertPlayScore, subscribePush,
} from './helpers';
import { deleteAccount, sweepDeletedAccounts } from '../src/lib/account';
import { replayKeyPrefix } from '../src/lib/replay-key';
import { rankingCacheKey } from '../src/lib/ranking-rule';

async function count(table: string, column: string, id: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).bind(id).first<{ n: number }>();
  return row!.n;
}

describe('Withdrawal (GameService.deleteAccount)', () => {
  beforeEach(resetDb);

  it('deletes the ID\'s records and replays, keeps others\', and refuses its cookie afterwards', async () => {
    const me = await registerUser({ name: 'Me' });
    const other = await registerUser({ name: 'Other' });
    const seedId = await getTodaySeedId(me.accessToken);
    const replayKey = `${replayKeyPrefix(me.userId)}${seedId}/r.json`;
    await env.R2.put(replayKey, '[]');
    await insertPlayScore({ userId: me.userId, seedId, moveCount: 9, score: 100, isCleared: true, replayLogKey: replayKey });
    await insertPlayScore({ userId: other.userId, seedId, moveCount: 9, score: 100, isCleared: true });
    await subscribePush(me.accessToken, 'https://fcm.googleapis.com/fcm/send/me');
    await env.KV.put(rankingCacheKey(seedId), '{"entries":[]}');

    await deleteAccount(testEnv(), me.userId);
    await deleteAccount(testEnv(), me.userId); // again: same result

    for (const [table, column] of [['play_scores', 'user_id'], ['push_subscriptions', 'user_id'], ['profiles', 'account_id']]) {
      expect(await count(table, column, me.userId), table).toBe(0);
    }
    expect(await count('play_scores', 'user_id', other.userId)).toBe(1);
    expect(await env.R2.get(replayKey)).toBeNull();
    expect(await env.KV.get(rankingCacheKey(seedId))).toBeNull();

    const res = await call('http://localhost/api/scores/my', { headers: authHeader(me.accessToken) });
    expect(res.status).toBe(410);
  });

  it('the daily sweep removes a record that landed after the deletion', async () => {
    const me = await registerUser();
    const seedId = await getTodaySeedId(me.accessToken);
    await deleteAccount(testEnv(), me.userId);
    await insertPlayScore({ userId: me.userId, seedId, moveCount: 9, score: 100, isCleared: true });

    await sweepDeletedAccounts(testEnv());
    expect(await count('play_scores', 'user_id', me.userId)).toBe(0);
  });
});
