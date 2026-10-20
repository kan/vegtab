import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { todayJST } from '../lib/date';
import { findOrCreateDailySeed } from '../lib/seed';
import { MODE } from '../lib/mode';

/** The user's stored best for a seed (POST /api/scores keeps only the best row) */
interface BestScore {
  isCleared: boolean;
  moveCount: number;
  score: number;
}

const BEST_COLUMNS = 'is_cleared, move_count, score';

interface BestScoreRow {
  is_cleared: number;
  move_count: number;
  score: number;
}

function toBestScore(row: BestScoreRow): BestScore {
  return { isCleared: !!row.is_cleared, moveCount: row.move_count, score: row.score };
}

export const seedRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// GET /api/seeds/daily - Get today's daily seed
seedRoutes.get('/daily', async (c) => {
  const today = todayJST();
  const seed = await findOrCreateDailySeed(c.env.DB, today);

  return c.json({
    seedId: seed.id,
    seedValue: seed.seed_value,
    shareCode: seed.share_code,
    date: today,
  });
});

// GET /api/seeds/daily/calendar - List past daily seeds
seedRoutes.get('/daily/calendar', async (c) => {
  const userId = c.get('userId');
  const month = c.req.query('month'); // YYYY-MM format

  let query = 'SELECT ps.id, ps.seed_value, ps.share_code, ps.daily_date FROM puzzle_seeds ps WHERE ps.is_daily = 1';
  const params: string[] = [];

  if (month) {
    query += ' AND ps.daily_date LIKE ?';
    params.push(`${month}%`);
  }
  query += ' ORDER BY ps.daily_date DESC';

  const seeds = await c.env.DB.prepare(query).bind(...params).all<{
    id: string; seed_value: string; share_code: string; daily_date: string;
  }>();

  // The user's stored best per seed (one row per user×seed×mode)
  const seedIds = (seeds.results ?? []).map((s) => s.id);
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
    seeds: (seeds.results ?? []).map((s) => ({
      seedId: s.id,
      seedValue: s.seed_value,
      shareCode: s.share_code,
      date: s.daily_date,
      userScores: userScores[s.id] ?? null,
    })),
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
