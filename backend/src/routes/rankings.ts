import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { todayJST } from '../lib/date';

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

  // Determine if this seed is a past daily puzzle
  const seedInfo = await db.prepare(
    'SELECT daily_date FROM puzzle_seeds WHERE id = ?'
  ).bind(seedId).first<{ daily_date: string | null }>();
  // Unknown seed: nothing to rank, and arbitrary ids must not create KV cache entries
  if (!seedInfo) return { ranking: [], userRank: null };
  const isPastDate = seedInfo.daily_date != null && seedInfo.daily_date < todayJST();

  const cacheKey = `ranking:${seedId}:${mode}`;
  const cached = await kv.get(cacheKey, 'json') as RankingData | null;
  if (cached) {
    // For past dates, expose scoreId on all entries
    const entries = isPastDate
      ? cached.entries.map(e => ({ ...e, scoreId: e.scoreId ?? e._scoreId }))
      : cached.entries.map(e => ({ ...e, scoreId: e.userId === userId ? (e.scoreId ?? e._scoreId) : undefined }));
    const cachedEntry = cached.entries.find(e => e.userId === userId);
    const userRank = cachedEntry
      ? { rank: cachedEntry.rank, score: cachedEntry.score, moveCount: cachedEntry.moveCount, cascadePoints: cachedEntry.cascadePoints }
      : await getUserRank(db, userId, seedId, mode as GameMode);
    return { ranking: entries, userRank };
  }

  const [rankingEntries, userRank] = await Promise.all([
    queryRanking(db, seedId, mode as GameMode, userId, isPastDate),
    getUserRank(db, userId, seedId, mode as GameMode),
  ]);

  // Cache always stores _scoreId so we can resolve per-user visibility on cache hit
  const cacheEntries = rankingEntries.map(e => ({ ...e, _scoreId: e.scoreId }));
  await kv.put(cacheKey, JSON.stringify({ entries: cacheEntries }), {
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

interface RankingEntry {
  rank: number;
  userId: string;
  displayName: string;
  score: number;
  moveCount: number;
  isCleared?: boolean;
  maxChain?: number;
  cascadePoints?: number;
  scoreId?: string;
  /** Internal: always present in cache, resolved to scoreId per visibility rules */
  _scoreId?: string;
}

interface RankingData {
  entries: RankingEntry[];
}

interface RankedRow {
  id: string;
  user_id: string;
  score: number;
  move_count: number;
  max_chain: number | null;
  cascade_points: number;
  rank: number;
}

/**
 * モードごとの順位の基準。一覧・「あなたの順位」の両方がここから作る SQL を使うので、食い違わない。
 * - filter: ランキングに載る記録の条件
 * - order: 良い順。すべての項目が同じなら同順位
 */
const RANKING_RULES: Record<GameMode, { filter: string; order: string }> = {
  sprint: { filter: '', order: 'score DESC' },
  clear: { filter: 'AND is_cleared = 1', order: 'move_count ASC, score DESC' },
  survival: { filter: '', order: 'move_count DESC, score DESC' },
  cascade: { filter: '', order: 'cascade_points DESC, score DESC' },
};

/**
 * ユーザーごとのベスト 1 件に絞り、同点を同順位にした順位（1, 1, 3, ...）を付ける CTE。
 * created_at はその seed×mode に初めて送った時刻（ベスト更新では変わらない）で、同順位の中の並びと、
 * 同じ記録が複数行あるときの代表を決めるのに使う。バインド: seed_id, mode
 */
function rankedCte(mode: GameMode): string {
  const { filter, order } = RANKING_RULES[mode];
  return `WITH best AS (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY ${order}, created_at, id) AS rn
       FROM play_scores
       WHERE seed_id = ? AND mode = ? ${filter}
     ), ranked AS (
       SELECT *, RANK() OVER (ORDER BY ${order}) AS rank FROM best WHERE rn = 1
     )`;
}

async function queryRanking(db: D1Database, seedId: string, mode: GameMode, userId: string, isPastDate = false): Promise<RankingEntry[]> {
  const { results } = await db.prepare(
    `${rankedCte(mode)}
     SELECT r.*, u.display_name FROM ranked r
     JOIN users u ON u.id = r.user_id
     ORDER BY r.rank, r.created_at, r.id
     LIMIT ?`
  ).bind(seedId, mode, RANKING_LIMIT).all<RankedRow & { display_name: string | null }>();

  return (results ?? []).map(e => ({
    rank: e.rank,
    userId: e.user_id,
    displayName: e.display_name ?? DEFAULT_DISPLAY_NAME,
    score: e.score,
    moveCount: e.move_count,
    scoreId: (isPastDate || e.user_id === userId) ? e.id : undefined,
    ...(mode === 'clear' && { isCleared: true }),
    ...(mode === 'cascade' && { maxChain: e.max_chain ?? 0, cascadePoints: e.cascade_points }),
  }));
}

async function getUserRank(
  db: D1Database,
  userId: string,
  seedId: string,
  mode: GameMode
): Promise<{ rank: number; score: number; moveCount?: number; maxChain?: number; cascadePoints?: number } | null> {
  const row = await db.prepare(
    `${rankedCte(mode)}
     SELECT * FROM ranked WHERE user_id = ?`
  ).bind(seedId, mode, userId).first<RankedRow>();
  if (!row) return null;

  return {
    rank: row.rank,
    score: row.score,
    ...((mode === 'clear' || mode === 'survival') && { moveCount: row.move_count }),
    ...(mode === 'cascade' && { maxChain: row.max_chain ?? 0, cascadePoints: row.cascade_points }),
  };
}
