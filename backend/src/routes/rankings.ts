import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';

const RANKING_CACHE_TTL = 300; // 5 minutes
const RANKING_LIMIT = 100;

export const rankingRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// GET /api/rankings/:seedId?mode=limited|free
rankingRoutes.get('/:seedId', async (c) => {
  const userId = c.get('userId');
  const seedId = c.req.param('seedId');
  const mode = c.req.query('mode') ?? 'limited';

  if (mode !== 'limited' && mode !== 'free') {
    return c.json({ error: 'Invalid mode' }, 400);
  }

  const cacheKey = `ranking:${seedId}:${mode}`;

  // Try KV cache
  const cached = await c.env.KV.get(cacheKey, 'json') as RankingData | null;
  if (cached) {
    // Add user's rank info
    const userRank = await getUserRank(c.env.DB, userId, seedId, mode);
    return c.json({ ranking: cached.entries, userRank });
  }

  // Query D1 for ranking
  const entries = await c.env.DB.prepare(
    `SELECT ps.user_id, u.display_name, MAX(ps.score) as best_score, ps.move_count
     FROM play_scores ps
     JOIN users u ON u.id = ps.user_id
     WHERE ps.seed_id = ? AND ps.mode = ?
       AND ps.used_brought_items = 0 AND ps.is_trial = 0
     GROUP BY ps.user_id
     ORDER BY best_score DESC
     LIMIT ?`
  ).bind(seedId, mode, RANKING_LIMIT).all<{
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
     WHERE user_id = ? AND seed_id = ? AND mode = ?
       AND used_brought_items = 0 AND is_trial = 0`
  ).bind(userId, seedId, mode).first<{ best_score: number | null }>();

  if (!userBest?.best_score) return null;

  const rankResult = await db.prepare(
    `SELECT COUNT(DISTINCT user_id) + 1 as rank FROM play_scores
     WHERE seed_id = ? AND mode = ? AND used_brought_items = 0 AND is_trial = 0
     AND score > ?`
  ).bind(seedId, mode, userBest.best_score).first<{ rank: number }>();
  if (!rankResult) return null;

  return { rank: rankResult.rank, score: userBest.best_score };
}
