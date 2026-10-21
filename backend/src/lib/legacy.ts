/**
 * Handing an old vegtab.app account over to a kan-game.app ID (#103, docs/SPEC.md §5.4).
 *
 * The old screen on vegtab.app still holds the account's tokens, so it asks for a one-time handoff
 * token (issueHandoff) and opens vegtab.kan-game.app with the token in the URL fragment. There the
 * player confirms, and the screen sends the token with the kan-game.app ID cookie (claimLegacy):
 * the account's records move to the ID, and its name is registered as the ID's name if it can be.
 * The old account is then removed, so it can be handed over only once.
 */
import { ACHIEVEMENT_DEFS } from '@vegtab/engine';
import type { Bindings } from '../types';
import { idPlatform } from './id-auth';
import { invalidateRankings, nameOutcome, openRankingSeedsOf, registerProfile } from './profile';

/** How long a handoff token can be used. Opening the old URL again gives a new one */
const HANDOFF_TTL_MS = 30 * 60 * 1000;

/**
 * The rows of an old account left after its records moved (records of seeds the ID already had, its
 * achievements) and the tables only the old screen used: dropped when it is handed over
 */
const LEGACY_TABLES = [
  'play_scores', 'achievements',
  'user_devices', 'transfer_codes', 'refresh_token_families', 'push_subscriptions', 'legacy_handoffs',
] as const;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A new handoff token for an old account (the old screen's request). Expired tokens are purged */
export async function issueHandoff(db: D1Database, userId: string, now = Date.now()): Promise<string> {
  const token = randomToken();
  await db.batch([
    db.prepare('DELETE FROM legacy_handoffs WHERE expires_at <= ?').bind(now),
    db.prepare('INSERT INTO legacy_handoffs (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256Hex(token), userId, now + HANDOFF_TTL_MS),
  ]);
  return token;
}

/**
 * What became of the old account's name: registered as the ID's name, the ID kept the name it
 * already had, taken by another ID or against the rules (the player chooses another), or none
 */
type ClaimedName = 'registered' | 'kept' | 'taken' | 'invalid' | 'none';

export type ClaimResult =
  | { ok: true; name: ClaimedName }
  | { ok: false; reason: 'invalid_token' };

interface AchievementRow {
  achievement_type: string;
  current_value: number;
  is_unlocked: number;
  unlocked_at: string | null;
}

/** The better progress of two rows of the same achievement */
function mergeAchievement(a: AchievementRow, b: AchievementRow): AchievementRow {
  const def = ACHIEVEMENT_DEFS.find(d => d.type === a.achievement_type);
  // clear_under_* keep the fewest moves; 0 means not reached
  const value = def?.comparator === 'lte'
    ? Math.min(...[a.current_value, b.current_value].filter(v => v > 0), Infinity)
    : Math.max(a.current_value, b.current_value);
  const unlockedAt = [a.unlocked_at, b.unlocked_at].filter((t): t is string => t != null).sort()[0] ?? null;
  return {
    achievement_type: a.achievement_type,
    current_value: Number.isFinite(value) ? value : 0,
    is_unlocked: a.is_unlocked || b.is_unlocked ? 1 : 0,
    unlocked_at: unlockedAt,
  };
}

/**
 * Moves the records of the old account a handoff token belongs to onto `accountId`. The records are
 * not merged into one per seed: where the ID already has a record of the same seed, the ID's is kept.
 * The old account's name is registered as the ID's name after the records moved.
 */
export async function claimLegacy(env: Bindings, accountId: string, token: string, now = Date.now()): Promise<ClaimResult> {
  const db = env.DB;
  const handoff = await db.prepare(
    `SELECT h.user_id, u.display_name FROM legacy_handoffs h JOIN users u ON u.id = h.user_id
     WHERE h.token_hash = ? AND h.expires_at > ?`
  ).bind(await sha256Hex(token), now).first<{ user_id: string; display_name: string | null }>();
  if (!handoff) return { ok: false, reason: 'invalid_token' };
  const legacyId = handoff.user_id;

  const [legacyAchievements, ownAchievements, seeds] = await Promise.all([
    ...[legacyId, accountId].map(id =>
      db.prepare('SELECT achievement_type, current_value, is_unlocked, unlocked_at FROM achievements WHERE user_id = ?')
        .bind(id).all<AchievementRow>().then(r => r.results)),
    openRankingSeedsOf(db, legacyId),
  ]) as [AchievementRow[], AchievementRow[], string[]];
  const own = new Map(ownAchievements.map(r => [r.achievement_type, r]));

  // One transaction. Every statement that moves records checks that the old account is still
  // there, so a second claim of the same account running alongside moves nothing
  const stillLegacy = 'EXISTS (SELECT 1 FROM users WHERE id = ?2)';
  const results = await db.batch([
    db.prepare(
      `UPDATE play_scores SET user_id = ?1 WHERE user_id = ?2 AND ${stillLegacy}
         AND seed_id NOT IN (SELECT seed_id FROM play_scores WHERE user_id = ?1)`
    ).bind(accountId, legacyId),
    ...legacyAchievements.map(row => {
      const merged = own.has(row.achievement_type) ? mergeAchievement(own.get(row.achievement_type)!, row) : row;
      return db.prepare(
        `INSERT INTO achievements (id, user_id, achievement_type, current_value, is_unlocked, unlocked_at)
         SELECT ?3, ?1, ?4, ?5, ?6, ?7 WHERE ${stillLegacy}
         ON CONFLICT (user_id, achievement_type) DO UPDATE SET
           current_value = excluded.current_value, is_unlocked = excluded.is_unlocked, unlocked_at = excluded.unlocked_at`
      ).bind(accountId, legacyId, crypto.randomUUID(), merged.achievement_type, merged.current_value,
        merged.is_unlocked, merged.unlocked_at);
    }),
    db.prepare(
      `INSERT INTO legacy_claims (legacy_user_id, account_id, claimed_at) SELECT ?2, ?1, ?3 WHERE ${stillLegacy}
       ON CONFLICT (legacy_user_id) DO NOTHING`
    ).bind(accountId, legacyId, now),
    ...LEGACY_TABLES.map(table =>
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(legacyId)),
    db.prepare('DELETE FROM users WHERE id = ?').bind(legacyId),
    db.prepare('SELECT account_id FROM legacy_claims WHERE legacy_user_id = ?').bind(legacyId),
  ]);

  const claimed = results.at(-1)!.results[0] as { account_id: string } | undefined;
  // Another claim of the same account won the race: the token was valid when this one started
  if (claimed?.account_id !== accountId) return { ok: false, reason: 'invalid_token' };

  // The name only after the claim: names cannot change, so a claim that lost the race must not take
  // the old account's name. If this fails, the records have moved and the player chooses a name
  const legacyName = handoff.display_name?.trim();
  const outcome = legacyName ? nameOutcome(await idPlatform(env).registerName(accountId, legacyName)) : null;
  const name: ClaimedName = !outcome ? 'none'
    : outcome.status === 'name_taken' ? 'taken'
    // no_id: the ID is being deleted, and its records with it
    : outcome.status === 'no_id' ? 'none'
    : outcome.status;

  if (outcome && 'name' in outcome) {
    // The old account published its name in the rankings: handing it over keeps that consent (the
    // confirmation screen says so). This also drops the caches of the rankings the records joined
    await registerProfile(env, accountId, outcome.name);
  } else {
    await invalidateRankings(env, seeds);
  }
  return { ok: true, name };
}
