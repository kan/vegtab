import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Bindings, Variables } from '../types';
import { generateId, generateShareCode } from '../lib/id';
import { generateDailySeed, isDateNearToday } from '../lib/date';

const submitScoreSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(['sprint', 'clear', 'survival']),
  moveLimit: z.number().int().nullable().optional(),
  moveCount: z.number().int(),
  score: z.number().int(),
  isCleared: z.boolean(),
  replayLog: z.array(z.unknown()),
});

export const scoreRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// POST /api/scores - Submit a score
scoreRoutes.post('/', zValidator('json', submitScoreSchema), async (c) => {
  const userId = c.get('userId');
  const data = c.req.valid('json');

  // Validate date is near today (±1 day for timezone tolerance)
  if (!isDateNearToday(data.date)) {
    return c.json({ error: 'Invalid date' }, 400);
  }

  // Find or create the daily seed for this date
  let seed = await c.env.DB.prepare(
    'SELECT id, seed_value, share_code FROM puzzle_seeds WHERE is_daily = 1 AND daily_date = ?'
  ).bind(data.date).first<{ id: string; seed_value: string; share_code: string }>();

  if (!seed) {
    const seedId = generateId();
    const seedValue = String(generateDailySeed(data.date));
    const shareCode = generateShareCode();
    await c.env.DB.prepare(
      'INSERT INTO puzzle_seeds (id, seed_value, share_code, is_daily, daily_date) VALUES (?, ?, ?, 1, ?)'
    ).bind(seedId, seedValue, shareCode, data.date).run();
    seed = { id: seedId, seed_value: seedValue, share_code: shareCode };
  }

  // Check for existing record
  const existing = await c.env.DB.prepare(
    `SELECT id, score, move_count, is_cleared FROM play_scores
     WHERE user_id = ? AND seed_id = ? AND mode = ?`
  ).bind(userId, seed.id, data.mode).first<{
    id: string; score: number; move_count: number; is_cleared: number;
  }>();

  // TODO: Replay verification with engine (Phase 3 enhancement)
  // For now, store the replay log and trust the score
  // Full verification: replay the actions with the engine and compare scores

  // Determine if new score is better
  let isBetter = true;
  if (existing) {
    if (data.mode === 'sprint') {
      isBetter = data.score > existing.score;
    } else if (data.mode === 'clear') {
      // Clear: fewer moves is better; new clear beats non-clear
      if (data.isCleared && !existing.is_cleared) {
        isBetter = true;
      } else if (!data.isCleared && existing.is_cleared) {
        isBetter = false;
      } else if (data.isCleared && existing.is_cleared) {
        isBetter = data.moveCount < existing.move_count;
      } else {
        isBetter = false; // both failed, keep existing
      }
    } else {
      // Survival: more moves is better
      isBetter = data.moveCount > existing.move_count;
    }
  }

  // Only write replay log to R2 if this score will be stored
  let scoreId: string;
  if (!existing) {
    const replayLogKey = `replays/${userId}/${seed.id}/${generateId()}.json`;
    scoreId = generateId();
    await Promise.all([
      c.env.R2.put(replayLogKey, JSON.stringify(data.replayLog)),
      c.env.DB.prepare(
        `INSERT INTO play_scores (id, user_id, seed_id, mode, move_limit, move_count, score, is_cleared, replay_log_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        scoreId, userId, seed.id, data.mode,
        data.moveLimit ?? null, data.moveCount, data.score,
        data.isCleared ? 1 : 0, replayLogKey
      ).run(),
    ]);
  } else if (isBetter) {
    const replayLogKey = `replays/${userId}/${seed.id}/${generateId()}.json`;
    scoreId = existing.id;
    await Promise.all([
      c.env.R2.put(replayLogKey, JSON.stringify(data.replayLog)),
      c.env.DB.prepare(
        `UPDATE play_scores SET move_limit = ?, move_count = ?, score = ?, is_cleared = ?, replay_log_key = ?
         WHERE id = ?`
      ).bind(
        data.moveLimit ?? null, data.moveCount, data.score,
        data.isCleared ? 1 : 0, replayLogKey,
        scoreId
      ).run(),
    ]);
  } else {
    scoreId = existing.id;
  }

  // Invalidate ranking cache
  await c.env.KV.delete(`ranking:${seed.id}:${data.mode}`);

  return c.json({ scoreId, shareCode: seed.share_code }, 201);
});

// GET /api/scores/my - Get user's play history
scoreRoutes.get('/my', async (c) => {
  const userId = c.get('userId');
  const seedId = c.req.query('seedId');

  let query = `SELECT ps.id, ps.seed_id, ps.mode, ps.move_count, ps.score, ps.is_cleared, ps.created_at
    FROM play_scores ps WHERE ps.user_id = ?`;
  const params: unknown[] = [userId];

  if (seedId) {
    query += ' AND ps.seed_id = ?';
    params.push(seedId);
  }
  query += ' ORDER BY ps.created_at DESC LIMIT 50';

  const scores = await c.env.DB.prepare(query).bind(...params).all<{
    id: string; seed_id: string; mode: string; move_count: number; score: number;
    is_cleared: number; created_at: string;
  }>();

  return c.json({
    scores: (scores.results ?? []).map((s) => ({
      id: s.id,
      seedId: s.seed_id,
      mode: s.mode,
      moveCount: s.move_count,
      score: s.score,
      isCleared: !!s.is_cleared,
      createdAt: s.created_at,
    })),
  });
});
