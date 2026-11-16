/**
 * Per-ID limits for the write APIs (#119, SPEC §5.3), counted in D1 in fixed windows.
 * Taken before the costly part of the request (replay verification, the ID platform's RPC), so a
 * refused request costs one D1 write.
 */
export const RATE_LIMITS = {
  /**
   * POST /api/scores. A day has one puzzle; a retry after a stuck board takes well over a few
   * seconds, and a flushed offline queue holds a handful of runs. Past days are answered before
   * this (they are not verified)
   */
  score: { limit: 10, windowMs: 60_000 },
  /** POST /api/user/profile (calls the ID platform's registerName) */
  profile: { limit: 10, windowMs: 60_000 },
} as const;

export type RateLimitAction = keyof typeof RATE_LIMITS;

/** Rows older than this are deleted by the daily scheduled run (longer than any window) */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Takes one request from the ID's window for `action`. Returns null when taken, or the seconds until
 * the window ends (for Retry-After) when the window is full. One statement, so concurrent requests
 * cannot both take the last slot.
 */
export async function takeRateLimitSlot(
  db: D1Database, accountId: string, action: RateLimitAction, now = Date.now(),
): Promise<{ retryAfterSeconds: number } | null> {
  const { limit, windowMs } = RATE_LIMITS[action];
  const windowStart = now - (now % windowMs);
  const row = await db.prepare(
    `INSERT INTO rate_limits (account_id, action, window_start, count) VALUES (?, ?, ?, 1)
     ON CONFLICT (account_id, action) DO UPDATE SET
       count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
       window_start = excluded.window_start
     RETURNING count`
  ).bind(accountId, action, windowStart).first<{ count: number }>();
  if (row && row.count > limit) {
    return { retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)) };
  }
  return null;
}

/** The daily scheduled run: drops the rows of windows long past */
export async function purgeStaleRateLimits(db: D1Database, now = Date.now()): Promise<void> {
  await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(now - STALE_AFTER_MS).run();
}
