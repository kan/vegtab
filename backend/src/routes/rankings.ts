import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { isRankingClosed } from '../lib/date';
import { MODE } from '../lib/mode';

const DEFAULT_DISPLAY_NAME = 'NO NAME';

const RANKING_CACHE_TTL = 300; // 5 minutes
const RANKING_LIMIT = 100;

export const rankingRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Shared ranking logic for both endpoints
async function fetchRanking(
  db: D1Database, kv: KVNamespace, userId: string, seedId: string, mode: string,
) {
  // `mode` is optional and defaults to clear; the removed modes are rejected
  if (mode !== MODE) {
    return { error: 'Invalid mode' as const };
  }

  // Determine if this seed is a past daily puzzle
  const seedInfo = await db.prepare(
    'SELECT daily_date FROM puzzle_seeds WHERE id = ?'
  ).bind(seedId).first<{ daily_date: string | null }>();
  // Unknown seed: nothing to rank, and arbitrary ids must not create KV cache entries
  if (!seedInfo) return { ranking: [], userRank: null };
  const rankingClosed = seedInfo.daily_date != null && isRankingClosed(seedInfo.daily_date);

  const cacheKey = `ranking:${seedId}:${MODE}`;
  const cached = await kv.get(cacheKey, 'json') as RankingData | null;
  if (cached) {
    // Once the ranking is closed, expose scoreId on all entries
    const entries = cached.entries.map(e => toPublicEntry(e, rankingClosed || e.userId === userId));
    const cachedEntry = cached.entries.find(e => e.userId === userId);
    const userRank = cachedEntry
      ? { rank: cachedEntry.rank, score: cachedEntry.score, moveCount: cachedEntry.moveCount }
      : await getUserRank(db, userId, seedId);
    return { ranking: entries, userRank };
  }

  const [rankingEntries, userRank] = await Promise.all([
    queryRanking(db, seedId),
    getUserRank(db, userId, seedId),
  ]);

  // Cache always stores _scoreId so we can resolve per-user visibility on cache hit
  await kv.put(cacheKey, JSON.stringify({ entries: rankingEntries }), {
    expirationTtl: RANKING_CACHE_TTL,
  });

  return {
    ranking: rankingEntries.map(e => toPublicEntry(e, rankingClosed || e.userId === userId)),
    userRank,
  };
}

// GET /api/rankings/by-value/:seedValue?mode=clear
rankingRoutes.get('/by-value/:seedValue', async (c) => {
  const seed = await c.env.DB.prepare(
    'SELECT id FROM puzzle_seeds WHERE seed_value = ?'
  ).bind(c.req.param('seedValue')).first<{ id: string }>();
  if (!seed) return c.json({ ranking: [], userRank: null });

  const result = await fetchRanking(
    c.env.DB, c.env.KV, c.get('userId'), seed.id, c.req.query('mode') ?? MODE,
  );
  if ('error' in result) return c.json({ error: result.error }, 400);
  return c.json(result);
});

// GET /api/rankings/:seedId?mode=clear
rankingRoutes.get('/:seedId', async (c) => {
  const result = await fetchRanking(
    c.env.DB, c.env.KV, c.get('userId'), c.req.param('seedId'), c.req.query('mode') ?? MODE,
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
  /** Always true: only cleared runs are ranked */
  isCleared: true;
  scoreId?: string;
}

/** Cached form: always holds the score id, resolved to scoreId per visibility rules */
interface CachedRankingEntry extends Omit<RankingEntry, 'scoreId' | 'isCleared'> {
  _scoreId: string;
}

interface RankingData {
  entries: CachedRankingEntry[];
}

function toPublicEntry(e: CachedRankingEntry, showScoreId: boolean): RankingEntry {
  const { _scoreId, ...rest } = e;
  return { ...rest, isCleared: true, scoreId: showScoreId ? _scoreId : undefined };
}

interface RankedRow {
  id: string;
  user_id: string;
  score: number;
  move_count: number;
  rank: number;
}

/** 良い順（少ない手数、同じ手数なら高いスコア）。すべての項目が同じなら同順位 */
const RANKING_ORDER = 'move_count ASC, score DESC';

/**
 * クリアした記録をユーザーごとのベスト 1 件に絞り、同点を同順位にした順位（1, 1, 3, ...）を付ける CTE。
 * 一覧・「あなたの順位」の両方がこれを使うので、食い違わない。
 * created_at はその seed×mode に初めて送った時刻（ベスト更新では変わらない）で、同順位の中の並びと、
 * 同じ記録が複数行あるときの代表を決めるのに使う。バインド: seed_id, mode
 */
const RANKED_CTE = `WITH best AS (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY ${RANKING_ORDER}, created_at, id) AS rn
       FROM play_scores
       WHERE seed_id = ? AND mode = ? AND is_cleared = 1
     ), ranked AS (
       SELECT *, RANK() OVER (ORDER BY ${RANKING_ORDER}) AS rank FROM best WHERE rn = 1
     )`;

async function queryRanking(db: D1Database, seedId: string): Promise<CachedRankingEntry[]> {
  const { results } = await db.prepare(
    `${RANKED_CTE}
     SELECT r.*, u.display_name FROM ranked r
     JOIN users u ON u.id = r.user_id
     ORDER BY r.rank, r.created_at, r.id
     LIMIT ?`
  ).bind(seedId, MODE, RANKING_LIMIT).all<RankedRow & { display_name: string | null }>();

  return (results ?? []).map(e => ({
    rank: e.rank,
    userId: e.user_id,
    displayName: e.display_name ?? DEFAULT_DISPLAY_NAME,
    score: e.score,
    moveCount: e.move_count,
    _scoreId: e.id,
  }));
}

async function getUserRank(
  db: D1Database,
  userId: string,
  seedId: string,
): Promise<{ rank: number; score: number; moveCount: number } | null> {
  const row = await db.prepare(
    `${RANKED_CTE}
     SELECT * FROM ranked WHERE user_id = ?`
  ).bind(seedId, MODE, userId).first<RankedRow>();
  if (!row) return null;

  return { rank: row.rank, score: row.score, moveCount: row.move_count };
}
