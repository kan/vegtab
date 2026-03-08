import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Bindings, Variables } from '../types';
import { generateId } from '../lib/id';
import { todayUTC } from '../lib/date';

const submitScoreSchema = z.object({
  seedId: z.string(),
  mode: z.enum(['limited', 'free']),
  moveLimit: z.number().int().nullable().optional(),
  moveCount: z.number().int(),
  score: z.number().int(),
  isCleared: z.boolean(),
  usedBroughtItems: z.boolean(),
  usedUndo: z.boolean(),
  isTrial: z.boolean(),
  replayLog: z.array(z.unknown()),
});

export const scoreRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// POST /api/scores - Submit a score
scoreRoutes.post('/', zValidator('json', submitScoreSchema), async (c) => {
  const userId = c.get('userId');
  const data = c.req.valid('json');

  // Verify seed exists
  const seed = await c.env.DB.prepare(
    'SELECT id, seed_value, is_daily, daily_date FROM puzzle_seeds WHERE id = ?'
  ).bind(data.seedId).first<{
    id: string; seed_value: string; is_daily: number; daily_date: string | null;
  }>();
  if (!seed) return c.json({ error: 'Seed not found' }, 404);

  // If not trial, verify user has access (daily today or unlocked)
  if (!data.isTrial) {
    const today = todayUTC();
    const isDailyToday = seed.is_daily && seed.daily_date === today;
    if (!isDailyToday) {
      const unlocked = await c.env.DB.prepare(
        'SELECT id FROM user_unlocked_seeds WHERE user_id = ? AND seed_id = ?'
      ).bind(userId, data.seedId).first();
      if (!unlocked) {
        return c.json({ error: 'Seed not unlocked' }, 403);
      }
    }
  }

  // TODO: Replay verification with engine (Phase 3 enhancement)
  // For now, store the replay log and trust the score
  // Full verification: replay the actions with the engine and compare scores

  // Store replay log in R2
  const replayLogKey = `replays/${userId}/${data.seedId}/${generateId()}.json`;
  await c.env.R2.put(replayLogKey, JSON.stringify(data.replayLog));

  // Record score
  const scoreId = generateId();
  await c.env.DB.prepare(
    `INSERT INTO play_scores (id, user_id, seed_id, mode, move_limit, move_count, score, is_cleared, used_brought_items, used_undo, is_trial, replay_log_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    scoreId, userId, data.seedId, data.mode,
    data.moveLimit ?? null, data.moveCount, data.score,
    data.isCleared ? 1 : 0, data.usedBroughtItems ? 1 : 0,
    data.usedUndo ? 1 : 0, data.isTrial ? 1 : 0, replayLogKey
  ).run();

  // Invalidate ranking cache if this is a rankable score
  if (!data.usedBroughtItems && !data.isTrial) {
    await c.env.KV.delete(`ranking:${data.seedId}:${data.mode}`);
  }

  // If undo was used in-game, consume from stock
  if (data.usedUndo) {
    await c.env.DB.prepare(
      "UPDATE users SET undo_stock = MAX(undo_stock - 1, 0), updated_at = datetime('now') WHERE id = ?"
    ).bind(userId).run();
  }

  return c.json({ scoreId }, 201);
});

// GET /api/scores/my - Get user's play history
scoreRoutes.get('/my', async (c) => {
  const userId = c.get('userId');
  const seedId = c.req.query('seedId');

  let query = `SELECT ps.id, ps.seed_id, ps.mode, ps.move_count, ps.score, ps.is_cleared,
    ps.used_brought_items, ps.used_undo, ps.is_trial, ps.created_at
    FROM play_scores ps WHERE ps.user_id = ?`;
  const params: unknown[] = [userId];

  if (seedId) {
    query += ' AND ps.seed_id = ?';
    params.push(seedId);
  }
  query += ' ORDER BY ps.created_at DESC LIMIT 50';

  const scores = await c.env.DB.prepare(query).bind(...params).all<{
    id: string; seed_id: string; mode: string; move_count: number; score: number;
    is_cleared: number; used_brought_items: number; used_undo: number;
    is_trial: number; created_at: string;
  }>();

  return c.json({
    scores: (scores.results ?? []).map((s) => ({
      id: s.id,
      seedId: s.seed_id,
      mode: s.mode,
      moveCount: s.move_count,
      score: s.score,
      isCleared: !!s.is_cleared,
      usedBroughtItems: !!s.used_brought_items,
      usedUndo: !!s.used_undo,
      isTrial: !!s.is_trial,
      createdAt: s.created_at,
    })),
  });
});
