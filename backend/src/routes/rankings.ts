import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';

const RANKING_CACHE_TTL = 300; // 5 minutes
const RANKING_LIMIT = 100;

export const rankingRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// GET /api/rankings/:seedId?mode=limited
rankingRoutes.get('/:seedId', async (c) => {
  const userId = c.get('userId');
  const seedId = c.req.param('seedId');
  const mode = c.req.query('mode') ?? 'limited';

  if (mode !== 'limited') {
    return c.json({ error: 'Invalid mode' }, 400);
  }

  const cacheKey = `ranking:${seedId}:${mode}`;

  // Try KV cache
  const cached = await c.env.KV.get(cacheKey, 'json') as RankingData | null;
  if (cached) {
    // Derive user rank from cached entries to avoid DB queries
    const cachedEntry = cached.entries.find(e => e.userId === userId);
    const userRank = cachedEntry
      ? { rank: cachedEntry.rank, score: cachedEntry.score }
      : await getUserRank(c.env.DB, userId, seedId, mode);
    return c.json({ ranking: cached.entries, userRank });
  }

  // Query D1 for ranking — use subquery to get move_count from the best-score row
  const entries = await c.env.DB.prepare(
    `SELECT r.user_id, u.display_name, r.best_score, ps2.move_count
     FROM (
       SELECT user_id, MAX(score) as best_score
       FROM play_scores
       WHERE seed_id = ? AND mode = ?
       GROUP BY user_id
     ) r
     JOIN play_scores ps2 ON ps2.user_id = r.user_id AND ps2.score = r.best_score
       AND ps2.seed_id = ? AND ps2.mode = ?
     JOIN users u ON u.id = r.user_id
     ORDER BY r.best_score DESC
     LIMIT ?`
  ).bind(seedId, mode, seedId, mode, RANKING_LIMIT).all<{
    user_id: string; display_name: string | null; best_score: number; move_count: number;
  }>();

  const rankingEntries = (entries.results ?? []).map((e, i) => ({
    rank: i + 1,
    userId: e.user_id,
    displayName: e.display_name ?? 'Anonymous',
    score: e.best_score,
    moveCount: e.move_count,
  }));

  // Cache in KV
  await c.env.KV.put(cacheKey, JSON.stringify({ entries: rankingEntries }), {
    expirationTtl: RANKING_CACHE_TTL,
  });

  const userRank = await getUserRank(c.env.DB, userId, seedId, mode);

  return c.json({ ranking: rankingEntries, userRank });
});

interface RankingData {
  entries: Array<{
    rank: number;
    userId: string;
    displayName: string;
    score: number;
    moveCount: number;
  }>;
}

async function getUserRank(
  db: D1Database,
  userId: string,
  seedId: string,
  mode: string
): Promise<{ rank: number; score: number } | null> {
  const userBest = await db.prepare(
    `SELECT MAX(score) as best_score FROM play_scores
     WHERE user_id = ? AND seed_id = ? AND mode = ?`
  ).bind(userId, seedId, mode).first<{ best_score: number | null }>();

  if (!userBest?.best_score) return null;

  const rankResult = await db.prepare(
    `SELECT COUNT(DISTINCT user_id) + 1 as rank FROM play_scores
     WHERE seed_id = ? AND mode = ?
     AND score > ?`
  ).bind(seedId, mode, userBest.best_score).first<{ rank: number }>();
  if (!rankResult) return null;

  return { rank: rankResult.rank, score: userBest.best_score };
}
