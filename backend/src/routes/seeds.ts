import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { daysOfMonth, todayJST } from '../lib/date';
import { deriveDailySeed, findOrCreateDailySeed } from '../lib/seed';
import { MODE } from '../lib/mode';

/** The user's stored best for a seed (POST /api/scores keeps only the best row) */
interface BestScore {
  isCleared: boolean;
  moveCount: number;
  /** クリアまでの時間（順位の 2 つ目の基準）。未クリアと、時間の記録がない記録は null */
  clearTimeMs: number | null;
  score: number;
}

const BEST_COLUMNS = 'is_cleared, move_count, clear_time_ms, score';

interface BestScoreRow {
  is_cleared: number;
  move_count: number;
  clear_time_ms: number | null;
  score: number;
}

function toBestScore(row: BestScoreRow): BestScore {
  return { isCleared: !!row.is_cleared, moveCount: row.move_count, clearTimeMs: row.clear_time_ms, score: row.score };
}

export const seedRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// GET /api/seeds/daily - Get today's daily seed
seedRoutes.get('/daily', async (c) => {
  const today = todayJST();
  const seed = await findOrCreateDailySeed(c.env.DB, c.env.DAILY_SEED_SECRET, today);

  return c.json({
    seedId: seed.id,
    seedValue: seed.seed_value,
    shareCode: seed.share_code,
    date: today,
  });
});

// GET /api/seeds/daily/calendar?month=YYYY-MM - The daily seed of every day of the month up to today
seedRoutes.get('/daily/calendar', async (c) => {
  const userId = c.get('userId');
  const month = c.req.query('month') ?? '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return c.json({ error: 'Invalid month' }, 400);

  const rows = await c.env.DB.prepare(
    'SELECT id, seed_value, share_code, daily_date FROM puzzle_seeds WHERE is_daily = 1 AND daily_date LIKE ?'
  ).bind(`${month}-%`).all<{ id: string; seed_value: string; share_code: string; daily_date: string }>();
  const rowByDate = new Map((rows.results ?? []).map((r) => [r.daily_date, r]));

  // Newest first, and never a day after today: its seed is not handed out yet.
  // A day nobody has played has no row yet. Its value is the one findOrCreateDailySeed will store,
  // so the calendar does not write rows (a GET that anyone can repeat for any month)
  const today = todayJST();
  const days = daysOfMonth(month).filter((d) => d <= today).reverse();
  const seeds = await Promise.all(days.map(async (date) => {
    const row = rowByDate.get(date);
    return row
      ? { seedId: row.id, seedValue: row.seed_value, shareCode: row.share_code, date }
      : { seedId: null, seedValue: String(await deriveDailySeed(c.env.DAILY_SEED_SECRET, date)), shareCode: null, date };
  }));

  // The user's stored best per seed (one row per user×seed×mode)
  const seedIds = seeds.flatMap((s) => (s.seedId ? [s.seedId] : []));
  const userScores: Record<string, BestScore> = {};
  if (seedIds.length > 0) {
    const placeholders = seedIds.map(() => '?').join(',');
    const scores = await c.env.DB.prepare(
      `SELECT seed_id, ${BEST_COLUMNS} FROM play_scores
       WHERE user_id = ? AND mode = ? AND seed_id IN (${placeholders})`
    ).bind(userId, MODE, ...seedIds).all<BestScoreRow & { seed_id: string }>();

    for (const s of scores.results ?? []) {
      userScores[s.seed_id] = toBestScore(s);
    }
  }

  return c.json({
    seeds: seeds.map((s) => ({ ...s, userScores: (s.seedId && userScores[s.seedId]) || null })),
  });
});

// GET /api/seeds/:id - Get seed info with user's best scores
seedRoutes.get('/:id', async (c) => {
  const userId = c.get('userId');
  const seedId = c.req.param('id');

  const seed = await c.env.DB.prepare(
    'SELECT id, seed_value, share_code, is_daily, daily_date FROM puzzle_seeds WHERE id = ?'
  ).bind(seedId).first<{
    id: string; seed_value: string; share_code: string;
    is_daily: number; daily_date: string | null;
  }>();
  if (!seed) return c.json({ error: 'Seed not found' }, 404);

  const best = await c.env.DB.prepare(
    `SELECT ${BEST_COLUMNS} FROM play_scores WHERE user_id = ? AND seed_id = ? AND mode = ?`
  ).bind(userId, seedId, MODE).first<BestScoreRow>();

  return c.json({
    seedId: seed.id,
    seedValue: seed.seed_value,
    shareCode: seed.share_code,
    isDaily: !!seed.is_daily,
    dailyDate: seed.daily_date,
    best: best ? toBestScore(best) : null,
  });
});

// GET /api/seeds/by-code/:code - Lookup seed by share code
seedRoutes.get('/by-code/:code', async (c) => {
  const code = c.req.param('code').toUpperCase();
  const seed = await c.env.DB.prepare(
    'SELECT id, seed_value, share_code FROM puzzle_seeds WHERE share_code = ?'
  ).bind(code).first<{ id: string; seed_value: string; share_code: string }>();
  if (!seed) return c.json({ error: 'Seed not found' }, 404);

  return c.json({ seedId: seed.id, seedValue: seed.seed_value, shareCode: seed.share_code });
});
