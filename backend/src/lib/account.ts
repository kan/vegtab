import type { Bindings } from '../types';
import { invalidateRankings, openRankingSeedsOf } from './profile';
import { replayKeyPrefix } from './replay-key';

/** The tables holding an ID's records, by the column naming the ID */
const ACCOUNT_TABLES = [
  ['play_scores', 'user_id'],
  ['achievements', 'user_id'],
  ['push_subscriptions', 'user_id'],
  ['profiles', 'account_id'],
  ['legacy_claims', 'account_id'],
] as const;

/**
 * Withdrawal from kan-game.app (GameService.deleteAccount): records the ID as deleted, so its
 * cookie can no longer write, and deletes all its records and replays. Calling it again gives the
 * same result. A write that was already past the cookie check when this ran can still land;
 * sweepDeletedAccounts removes that later.
 */
export async function deleteAccount(env: Bindings, accountId: string): Promise<void> {
  const seeds = await openRankingSeedsOf(env.DB, accountId);
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO deleted_accounts (account_id, deleted_at) VALUES (?, ?) ON CONFLICT (account_id) DO NOTHING'
    ).bind(accountId, Date.now()),
    ...ACCOUNT_TABLES.map(([table, column]) =>
      env.DB.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).bind(accountId)),
  ]);
  await Promise.all([deleteReplays(env.R2, accountId), invalidateRankings(env, seeds)]);
}

/** Deletes any record of a deleted ID again (the daily scheduled run) */
export async function sweepDeletedAccounts(env: Bindings): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT user_id AS id FROM play_scores WHERE user_id IN (SELECT account_id FROM deleted_accounts)`
  ).all<{ id: string }>();
  await env.DB.batch(ACCOUNT_TABLES.map(([table, column]) =>
    env.DB.prepare(`DELETE FROM ${table} WHERE ${column} IN (SELECT account_id FROM deleted_accounts)`)));
  for (const { id } of results) await deleteReplays(env.R2, id);
}

async function deleteReplays(bucket: R2Bucket, accountId: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix: replayKeyPrefix(accountId), cursor });
    if (listed.objects.length > 0) await bucket.delete(listed.objects.map(o => o.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}
