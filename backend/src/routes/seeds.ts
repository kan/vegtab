import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { daysOfMonth, todayJST } from '../lib/date';
import { findOrCreateDailySeed } from '../lib/seed';
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

  const [rows, first] = await Promise.all([
    c.env.DB.prepare(
      'SELECT id, seed_value, share_code, daily_date FROM puzzle_seeds WHERE is_daily = 1 AND daily_date LIKE ?'
    ).bind(`${month}-%`).all<{ id: string; seed_value: string; share_code: string; daily_date: string }>(),
    c.env.DB.prepare('SELECT MIN(daily_date) AS date FROM puzzle_seeds WHERE is_daily = 1').first<{ date: string | null }>(),
  ]);
  const rowByDate = new Map((rows.results ?? []).map((r) => [r.daily_date, r]));

  // Newest first, from the first daily that was ever handed out to today. Never a day after today:
  // its seed is not handed out yet. A day handed out here without a row yet (nobody opened it) gets
  // its row now, so every seed handed out has one (by-value and the first day rely on it). Only the
  // days between the first row and today get one, each once, so a GET cannot make rows for any month
  const today = todayJST();
  const firstDate = first?.date ?? today;
  const days = daysOfMonth(month).filter((d) => d >= firstDate && d <= today).reverse();
  const seeds = await Promise.all(days.map(async (date) => {
    const row = rowByDate.get(date) ?? await findOrCreateDailySeed(c.env.DB, c.env.DAILY_SEED_SECRET, date);
    return { seedId: row.id, seedValue: row.seed_value, shareCode: row.share_code, date };
  }));

  // The user's stored best per seed (one row per user×seed×mode)
  const seedIds = seeds.map((s) => s.seedId);
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
    seeds: seeds.map((s) => ({ ...s, userScores: userScores[s.seedId] ?? null })),
    /** The first day the calendar lists (the screen stops paging back at its month) */
    firstDate,
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

// GET /api/seeds/by-value/:value - The day of a daily seed (a shared link names only the seed)
// Only rows answer, and a row exists only for a day up to today, so no seed of a day ahead is revealed
seedRoutes.get('/by-value/:value', async (c) => {
  const seed = await c.env.DB.prepare(
    'SELECT seed_value, daily_date FROM puzzle_seeds WHERE is_daily = 1 AND seed_value = ?'
  ).bind(c.req.param('value')).first<{ seed_value: string; daily_date: string }>();
  if (!seed) return c.json({ error: 'Seed not found' }, 404);

  return c.json({ seedValue: seed.seed_value, date: seed.daily_date });
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
