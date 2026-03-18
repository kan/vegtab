import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';

const DEFAULT_DISPLAY_NAME = 'NO NAME';

const RANKING_CACHE_TTL = 300; // 5 minutes
const RANKING_LIMIT = 100;

const VALID_MODES = ['sprint', 'clear', 'survival', 'cascade'] as const;
type GameMode = (typeof VALID_MODES)[number];

export const rankingRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Shared ranking logic for both endpoints
async function fetchRanking(
  db: D1Database, kv: KVNamespace, userId: string, seedId: string, mode: string,
) {
  if (!VALID_MODES.includes(mode as GameMode)) {
    return { error: 'Invalid mode' as const };
  }

  const cacheKey = `ranking:${seedId}:${mode}`;
  const cached = await kv.get(cacheKey, 'json') as RankingData | null;
  if (cached) {
    const cachedEntry = cached.entries.find(e => e.userId === userId);
    const userRank = cachedEntry
      ? { rank: cachedEntry.rank, score: cachedEntry.score, moveCount: cachedEntry.moveCount }
      : await getUserRank(db, userId, seedId, mode as GameMode);
    return { ranking: cached.entries, userRank };
  }

  const [rankingEntries, userRank] = await Promise.all([
    queryRanking(db, seedId, mode as GameMode, userId),
    getUserRank(db, userId, seedId, mode as GameMode),
  ]);

  await kv.put(cacheKey, JSON.stringify({ entries: rankingEntries }), {
    expirationTtl: RANKING_CACHE_TTL,
  });

  return { ranking: rankingEntries, userRank };
}

// GET /api/rankings/by-value/:seedValue?mode=sprint
rankingRoutes.get('/by-value/:seedValue', async (c) => {
  const seed = await c.env.DB.prepare(
    'SELECT id FROM puzzle_seeds WHERE seed_value = ?'
  ).bind(c.req.param('seedValue')).first<{ id: string }>();
  if (!seed) return c.json({ ranking: [], userRank: null });

  const result = await fetchRanking(
    c.env.DB, c.env.KV, c.get('userId'), seed.id, c.req.query('mode') ?? 'sprint',
  );
  if ('error' in result) return c.json({ error: result.error }, 400);
  return c.json(result);
});

// GET /api/rankings/:seedId?mode=sprint
rankingRoutes.get('/:seedId', async (c) => {
  const result = await fetchRanking(
    c.env.DB, c.env.KV, c.get('userId'), c.req.param('seedId'), c.req.query('mode') ?? 'sprint',
  );
  if ('error' in result) return c.json({ error: result.error }, 400);
  return c.json(result);
});

function cascadeRankingSQL(): string {
  return `SELECT r.user_id, u.display_name, r.best_chain, ps2.score, ps2.move_count, ps2.id as score_id
     FROM (
       SELECT user_id, MAX(max_chain) as best_chain
       FROM play_scores
       WHERE seed_id = ? AND mode = ?
       GROUP BY user_id
     ) r
     JOIN play_scores ps2 ON ps2.user_id = r.user_id AND ps2.max_chain = r.best_chain
       AND ps2.seed_id = ? AND ps2.mode = ?
     JOIN users u ON u.id = r.user_id
     ORDER BY r.best_chain DESC, ps2.score DESC
     LIMIT ?`;
}

interface RankingEntry {
  rank: number;
  userId: string;
  displayName: string;
  score: number;
  moveCount: number;
  isCleared?: boolean;
  maxChain?: number;
  scoreId?: string;
}

interface RankingData {
  entries: RankingEntry[];
}

// --- Mode-specific ranking queries ---

function sprintRankingSQL(): string {
  return `SELECT r.user_id, u.display_name, r.best_score, ps2.move_count, ps2.id as score_id
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
     LIMIT ?`;
}

function clearRankingSQL(): string {
  return `SELECT r.user_id, u.display_name, r.best_move_count, ps2.score, ps2.is_cleared, ps2.id as score_id
     FROM (
       SELECT user_id, MIN(move_count) as best_move_count
       FROM play_scores
       WHERE seed_id = ? AND mode = ? AND is_cleared = 1
       GROUP BY user_id
     ) r
     JOIN play_scores ps2 ON ps2.user_id = r.user_id AND ps2.move_count = r.best_move_count
       AND ps2.seed_id = ? AND ps2.mode = ? AND ps2.is_cleared = 1
     JOIN users u ON u.id = r.user_id
     ORDER BY r.best_move_count ASC, ps2.score DESC
     LIMIT ?`;
}

function survivalRankingSQL(): string {
  return `SELECT r.user_id, u.display_name, r.best_move_count, ps2.score, ps2.id as score_id
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

function mapBaseEntry(
  e: { user_id: string; display_name: string | null; score_id: string },
  i: number, userId: string, extra: Partial<RankingEntry>,
): RankingEntry {
  return {
    rank: i + 1,
    userId: e.user_id,
    displayName: e.display_name ?? DEFAULT_DISPLAY_NAME,
    score: 0,
    moveCount: 0,
    scoreId: e.user_id === userId ? e.score_id : undefined,
    ...extra,
  };
}

async function queryRanking(db: D1Database, seedId: string, mode: GameMode, userId: string): Promise<RankingEntry[]> {
  if (mode === 'sprint') {
    const entries = await db.prepare(sprintRankingSQL())
      .bind(seedId, mode, seedId, mode, RANKING_LIMIT)
      .all<{ user_id: string; display_name: string | null; best_score: number; move_count: number; score_id: string }>();
    return (entries.results ?? []).map((e, i) =>
      mapBaseEntry(e, i, userId, { score: e.best_score, moveCount: e.move_count }),
    );
  }

  if (mode === 'clear') {
    const entries = await db.prepare(clearRankingSQL())
      .bind(seedId, mode, seedId, mode, RANKING_LIMIT)
      .all<{ user_id: string; display_name: string | null; best_move_count: number; score: number; is_cleared: number; score_id: string }>();
    return (entries.results ?? []).map((e, i) =>
      mapBaseEntry(e, i, userId, { score: e.score, moveCount: e.best_move_count, isCleared: true }),
    );
  }

  if (mode === 'cascade') {
    const entries = await db.prepare(cascadeRankingSQL())
      .bind(seedId, mode, seedId, mode, RANKING_LIMIT)
      .all<{ user_id: string; display_name: string | null; best_chain: number; score: number; move_count: number; score_id: string }>();
    return (entries.results ?? []).map((e, i) =>
      mapBaseEntry(e, i, userId, { score: e.score, moveCount: e.move_count, maxChain: e.best_chain }),
    );
  }

  // survival
  const entries = await db.prepare(survivalRankingSQL())
    .bind(seedId, mode, seedId, mode, RANKING_LIMIT)
    .all<{ user_id: string; display_name: string | null; best_move_count: number; score: number; score_id: string }>();
  return (entries.results ?? []).map((e, i) =>
    mapBaseEntry(e, i, userId, { score: e.score, moveCount: e.best_move_count }),
  );
}

// --- Mode-specific user rank ---

async function getUserRank(
  db: D1Database,
  userId: string,
  seedId: string,
  mode: GameMode
): Promise<{ rank: number; score: number; moveCount?: number; maxChain?: number } | null> {
  if (mode === 'sprint') {
    return getSprintUserRank(db, userId, seedId);
  }
  if (mode === 'clear') {
    return getClearUserRank(db, userId, seedId);
  }
  if (mode === 'cascade') {
    return getCascadeUserRank(db, userId, seedId);
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
     ORDER BY move_count ASC, score DESC LIMIT 1`
  ).bind(userId, seedId).first<{ best_move_count: number | null; score: number | null }>();

  if (!userBest?.best_move_count) return null;

  // Count users with strictly better results (fewer moves, or same moves but higher score)
  const rankResult = await db.prepare(
    `SELECT COUNT(DISTINCT user_id) + 1 as rank FROM play_scores
     WHERE seed_id = ? AND mode = 'clear' AND is_cleared = 1
     AND (move_count < ? OR (move_count = ? AND score > ?))`
  ).bind(seedId, userBest.best_move_count, userBest.best_move_count, userBest.score ?? 0).first<{ rank: number }>();
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

async function getCascadeUserRank(
  db: D1Database, userId: string, seedId: string
): Promise<{ rank: number; score: number; maxChain: number } | null> {
  const userBest = await db.prepare(
    `SELECT MAX(max_chain) as best_chain, score FROM play_scores
     WHERE user_id = ? AND seed_id = ? AND mode = 'cascade'
     ORDER BY max_chain DESC, score DESC LIMIT 1`
  ).bind(userId, seedId).first<{ best_chain: number | null; score: number | null }>();

  if (!userBest?.best_chain) return null;

  const rankResult = await db.prepare(
    `SELECT COUNT(DISTINCT user_id) + 1 as rank FROM play_scores
     WHERE seed_id = ? AND mode = 'cascade'
     AND (max_chain > ? OR (max_chain = ? AND score > ?))`
  ).bind(seedId, userBest.best_chain, userBest.best_chain, userBest.score ?? 0).first<{ rank: number }>();
  if (!rankResult) return null;

  return { rank: rankResult.rank, score: userBest.score ?? 0, maxChain: userBest.best_chain };
}
