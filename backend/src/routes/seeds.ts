import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { generateId, generateShareCode } from '../lib/id';
import { todayUTC, generateDailySeed } from '../lib/date';

export const seedRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// GET /api/seeds/daily - Get today's daily seed
seedRoutes.get('/daily', async (c) => {
  const today = todayUTC();

  let seed = await c.env.DB.prepare(
    'SELECT id, seed_value, share_code FROM puzzle_seeds WHERE is_daily = 1 AND daily_date = ?'
  ).bind(today).first<{ id: string; seed_value: string; share_code: string }>();

  if (!seed) {
    const seedId = generateId();
    const seedValue = String(generateDailySeed(today));
    const shareCode = generateShareCode();
    await c.env.DB.prepare(
      'INSERT INTO puzzle_seeds (id, seed_value, share_code, is_daily, daily_date) VALUES (?, ?, ?, 1, ?)'
    ).bind(seedId, seedValue, shareCode, today).run();
    seed = { id: seedId, seed_value: seedValue, share_code: shareCode };
  }

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

  // Check which seeds the user has played
  const seedIds = (seeds.results ?? []).map((s) => s.id);
  let userScores: Record<string, { sprint: number | null }> = {};
  if (seedIds.length > 0) {
    const placeholders = seedIds.map(() => '?').join(',');
    const scores = await c.env.DB.prepare(
      `SELECT seed_id, mode, MAX(score) as best_score FROM play_scores
       WHERE user_id = ? AND seed_id IN (${placeholders})
       GROUP BY seed_id, mode`
    ).bind(userId, ...seedIds).all<{ seed_id: string; mode: string; best_score: number }>();

    for (const s of scores.results ?? []) {
      if (!userScores[s.seed_id]) userScores[s.seed_id] = { sprint: null };
      if (s.mode === 'sprint') {
        userScores[s.seed_id].sprint = s.best_score;
      }
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

  // Get user's best scores
  const scores = await c.env.DB.prepare(
    'SELECT mode, MAX(score) as best_score FROM play_scores WHERE user_id = ? AND seed_id = ? GROUP BY mode'
  ).bind(userId, seedId).all<{ mode: string; best_score: number }>();

  const bestScores: Record<string, number> = {};
  for (const s of scores.results ?? []) {
    bestScores[s.mode] = s.best_score;
  }

  return c.json({
    seedId: seed.id,
    seedValue: seed.seed_value,
    shareCode: seed.share_code,
    isDaily: !!seed.is_daily,
    dailyDate: seed.daily_date,
    bestScores,
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
