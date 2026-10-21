import type { Bindings } from '../types';
import type { RegisterNameResult } from './id-rpc';
import { rankingCacheKey } from './ranking-rule';
import { todayJST } from './date';

/** The name an ID publishes in vegtab's rankings, or null before it consented */
export async function getProfileName(db: D1Database, accountId: string): Promise<string | null> {
  const row = await db.prepare('SELECT display_name FROM profiles WHERE account_id = ?')
    .bind(accountId).first<{ display_name: string }>();
  return row?.display_name ?? null;
}

/**
 * The ID platform's answer to registerName, as vegtab uses it: the ID's name (newly registered, or
 * the one it already had), or why it has none
 */
export type NameOutcome =
  | { status: 'registered' | 'kept'; name: string }
  | { status: 'name_taken' | 'invalid' | 'no_id' };

export function nameOutcome(registered: RegisterNameResult): NameOutcome {
  switch (registered.result) {
    case 'ok':
      return { status: 'registered', name: registered.name };
    case 'already_named':
      return { status: 'kept', name: registered.name };
    case 'name_taken':
    case 'invalid':
    case 'no_id':
      return { status: registered.result };
    default: {
      // A result added to kan/game's src/rpc.ts fails to compile here
      const unexpected: never = registered;
      throw new Error(`Unexpected registerName result: ${JSON.stringify(unexpected)}`);
    }
  }
}

/**
 * Stores the name the ID platform registered for the ID, with the consent to publish it here.
 * The first consent's time is kept. The ID's records join the rankings, so their caches go
 */
export async function registerProfile(env: Bindings, accountId: string, name: string): Promise<void> {
  const [, seeds] = await env.DB.batch<{ seed_id: string }>([
    env.DB.prepare(
      `INSERT INTO profiles (account_id, display_name, consented_at) VALUES (?, ?, ?)
       ON CONFLICT (account_id) DO UPDATE SET display_name = excluded.display_name`
    ).bind(accountId, name, Date.now()),
    openRankingSeedsQuery(env.DB, accountId),
  ]);
  await invalidateRankings(env, seeds.results.map(r => r.seed_id));
}

/**
 * The seeds of an account's records whose rankings are still open (today, and yesterday in its grace
 * period). Their cached rankings change with the account's records. A closed ranking's cache
 * expires within minutes (RANKING_CACHE_TTL), so it is left to expire rather than deleted for every
 * day the account played
 */
export async function openRankingSeedsOf(db: D1Database, accountId: string): Promise<string[]> {
  const { results } = await openRankingSeedsQuery(db, accountId).all<{ seed_id: string }>();
  return results.map(r => r.seed_id);
}

function openRankingSeedsQuery(db: D1Database, accountId: string): D1PreparedStatement {
  const yesterday = todayJST(Date.now() - 24 * 60 * 60 * 1000);
  return db.prepare(
    `SELECT DISTINCT ps.seed_id FROM play_scores ps JOIN puzzle_seeds s ON s.id = ps.seed_id
     WHERE ps.user_id = ? AND s.daily_date >= ?`
  ).bind(accountId, yesterday);
}

/** Drops the ranking caches of the seeds */
export async function invalidateRankings(env: Bindings, seedIds: Iterable<string>): Promise<void> {
  await Promise.all([...new Set(seedIds)].map(id => env.KV.delete(rankingCacheKey(id))));
}
