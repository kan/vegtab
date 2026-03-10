import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';

const RANKING_CACHE_TTL = 300; // 5 minutes
const RANKING_LIMIT = 100;

const VALID_MODES = ['sprint', 'clear', 'survival'] as const;
type GameMode = (typeof VALID_MODES)[number];

export const rankingRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// GET /api/rankings/:seedId?mode=sprint
rankingRoutes.get('/:seedId', async (c) => {
  const userId = c.get('userId');
  const seedId = c.req.param('seedId');
  const mode = (c.req.query('mode') ?? 'sprint') as string;

  if (!VALID_MODES.includes(mode as GameMode)) {
    return c.json({ error: 'Invalid mode' }, 400);
  }

  const cacheKey = `ranking:${seedId}:${mode}`;

  // Try KV cache
  const cached = await c.env.KV.get(cacheKey, 'json') as RankingData | null;
  if (cached) {
    const cachedEntry = cached.entries.find(e => e.userId === userId);
    const userRank = cachedEntry
      ? { rank: cachedEntry.rank, score: cachedEntry.score, moveCount: cachedEntry.moveCount }
      : await getUserRank(c.env.DB, userId, seedId, mode as GameMode);
    return c.json({ ranking: cached.entries, userRank });
  }

  const rankingEntries = await queryRanking(c.env.DB, seedId, mode as GameMode);

  // Cache in KV
  await c.env.KV.put(cacheKey, JSON.stringify({ entries: rankingEntries }), {
    expirationTtl: RANKING_CACHE_TTL,
  });

  const userRank = await getUserRank(c.env.DB, userId, seedId, mode as GameMode);

  return c.json({ ranking: rankingEntries, userRank });
});

interface RankingEntry {
  rank: number;
  userId: string;
  displayName: string;
  score: number;
  moveCount: number;
  isCleared?: boolean;
}

interface RankingData {
  entries: RankingEntry[];
}

// --- Mode-specific ranking queries ---

function sprintRankingSQL(): { sql: string; orderDesc: string } {
  return {
    sql: `SELECT r.user_id, u.display_name, r.best_score, ps2.move_count
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
     LIMIT ?`,
    orderDesc: 'score DESC',
  };
}

function clearRankingSQL(): string {
  return `SELECT r.user_id, u.display_name, r.best_move_count, ps2.score, ps2.is_cleared
     FROM (
       SELECT user_id, MIN(move_count) as best_move_count
       FROM play_scores
       WHERE seed_id = ? AND mode = ? AND is_cleared = 1
       GROUP BY user_id
     ) r
     JOIN play_scores ps2 ON ps2.user_id = r.user_id AND ps2.move_count = r.best_move_count
       AND ps2.seed_id = ? AND ps2.mode = ? AND ps2.is_cleared = 1
     JOIN users u ON u.id = r.user_id
     ORDER BY r.best_move_count ASC
     LIMIT ?`;
}

function survivalRankingSQL(): string {
  return `SELECT r.user_id, u.display_name, r.best_move_count, ps2.score
     FROM (
       SELECT user_id, MAX(move_count) as best_move_count
       FROM play_scores
       WHERE seed_id = ? AND mode = ?
       GROUP BY user_id
     ) r
     JOIN play_scores ps2 ON ps2.user_id = r.user_id AND ps2.move_count = r.best_move_count
       AND ps2.seed_id = ? AND ps2.mode = ?
     JOIN users u ON u.id = r.user_id
     ORDER BY r.best_move_count DESC, ps2.score DESC
     LIMIT ?`;
}

async function queryRanking(db: D1Database, seedId: string, mode: GameMode): Promise<RankingEntry[]> {
  if (mode === 'sprint') {
    const entries = await db.prepare(sprintRankingSQL().sql)
      .bind(seedId, mode, seedId, mode, RANKING_LIMIT)
      .all<{ user_id: string; display_name: string | null; best_score: number; move_count: number }>();
    return (entries.results ?? []).map((e, i) => ({
      rank: i + 1,
      userId: e.user_id,
      displayName: e.display_name ?? 'Anonymous',
      score: e.best_score,
      moveCount: e.move_count,
    }));
  }

  if (mode === 'clear') {
    const entries = await db.prepare(clearRankingSQL())
      .bind(seedId, mode, seedId, mode, RANKING_LIMIT)
      .all<{ user_id: string; display_name: string | null; best_move_count: number; score: number; is_cleared: number }>();
    return (entries.results ?? []).map((e, i) => ({
      rank: i + 1,
      userId: e.user_id,
      displayName: e.display_name ?? 'Anonymous',
      score: e.score,
      moveCount: e.best_move_count,
      isCleared: true,
    }));
  }

  // survival
  const entries = await db.prepare(survivalRankingSQL())
    .bind(seedId, mode, seedId, mode, RANKING_LIMIT)
    .all<{ user_id: string; display_name: string | null; best_move_count: number; score: number }>();
  return (entries.results ?? []).map((e, i) => ({
    rank: i + 1,
    userId: e.user_id,
    displayName: e.display_name ?? 'Anonymous',
    score: e.score,
    moveCount: e.best_move_count,
  }));
}

// --- Mode-specific user rank ---

async function getUserRank(
  db: D1Database,
  userId: string,
  seedId: string,
  mode: GameMode
): Promise<{ rank: number; score: number; moveCount?: number } | null> {
  if (mode === 'sprint') {
    return getSprintUserRank(db, userId, seedId);
  }
  if (mode === 'clear') {
    return getClearUserRank(db, userId, seedId);
  }
  return getSurvivalUserRank(db, userId, seedId);
}

async function getSprintUserRank(
  db: D1Database, userId: string, seedId: string
): Promise<{ rank: number; score: number } | null> {
  const userBest = await db.prepare(
    `SELECT MAX(score) as best_score FROM play_scores
     WHERE user_id = ? AND seed_id = ? AND mode = 'sprint'`
  ).bind(userId, seedId).first<{ best_score: number | null }>();

  if (!userBest?.best_score) return null;

  const rankResult = await db.prepare(
    `SELECT COUNT(DISTINCT user_id) + 1 as rank FROM play_scores
     WHERE seed_id = ? AND mode = 'sprint'
     AND score > ?`
  ).bind(seedId, userBest.best_score).first<{ rank: number }>();
  if (!rankResult) return null;

  return { rank: rankResult.rank, score: userBest.best_score };
}

async function getClearUserRank(
  db: D1Database, userId: string, seedId: string
): Promise<{ rank: number; score: number; moveCount: number } | null> {
  const userBest = await db.prepare(
    `SELECT MIN(move_count) as best_move_count, score FROM play_scores
     WHERE user_id = ? AND seed_id = ? AND mode = 'clear' AND is_cleared = 1
     ORDER BY move_count ASC LIMIT 1`
  ).bind(userId, seedId).first<{ best_move_count: number | null; score: number | null }>();

  if (!userBest?.best_move_count) return null;

  const rankResult = await db.prepare(
    `SELECT COUNT(DISTINCT user_id) + 1 as rank FROM play_scores
     WHERE seed_id = ? AND mode = 'clear' AND is_cleared = 1
     AND move_count < ?`
  ).bind(seedId, userBest.best_move_count).first<{ rank: number }>();
  if (!rankResult) return null;

  return { rank: rankResult.rank, score: userBest.score ?? 0, moveCount: userBest.best_move_count };
}

async function getSurvivalUserRank(
  db: D1Database, userId: string, seedId: string
): Promise<{ rank: number; score: number; moveCount: number } | null> {
  const userBest = await db.prepare(
    `SELECT MAX(move_count) as best_move_count, score FROM play_scores
     WHERE user_id = ? AND seed_id = ? AND mode = 'survival'
     ORDER BY move_count DESC, score DESC LIMIT 1`
  ).bind(userId, seedId).first<{ best_move_count: number | null; score: number | null }>();

  if (!userBest?.best_move_count) return null;

  // Count users with strictly better results (more moves, or same moves but higher score)
  const rankResult = await db.prepare(
    `SELECT COUNT(DISTINCT user_id) + 1 as rank FROM play_scores
     WHERE seed_id = ? AND mode = 'survival'
     AND (move_count > ? OR (move_count = ? AND score > ?))`
  ).bind(seedId, userBest.best_move_count, userBest.best_move_count, userBest.score ?? 0).first<{ rank: number }>();
  if (!rankResult) return null;

  return { rank: rankResult.rank, score: userBest.score ?? 0, moveCount: userBest.best_move_count };
}
