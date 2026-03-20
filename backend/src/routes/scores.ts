import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Bindings, Variables } from '../types';
import { generateId } from '../lib/id';
import { isDateNearToday, todayJST } from '../lib/date';
import { findOrCreateDailySeed } from '../lib/seed';
import { evaluateAchievements } from '../lib/achievements';

const submitScoreSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(['sprint', 'clear', 'survival', 'cascade']),
  moveLimit: z.number().int().nullable().optional(),
  moveCount: z.number().int(),
  score: z.number().int(),
  isCleared: z.boolean(),
  maxChain: z.number().int().optional().default(0),
  cascadePoints: z.number().int().optional().default(0),
  generatedItemTypes: z.array(z.string()).optional().default([]),
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

  // Find or create the daily seed
  const seed = await findOrCreateDailySeed(c.env.DB, data.date);

  // Past dates: allow play but don't record to ranking
  const isPastDate = data.date < todayJST();
  if (isPastDate) {
    return c.json({ scoreId: null, shareCode: seed.share_code, newAchievements: [], pastDate: true }, 200);
  }

  // Check for existing score
  const existing = await c.env.DB.prepare(
    `SELECT id, score, move_count, is_cleared, max_chain, cascade_points, replay_log_key FROM play_scores
     WHERE user_id = ? AND seed_id = ? AND mode = ?`
  ).bind(userId, seed.id, data.mode).first<{
    id: string; score: number; move_count: number; is_cleared: number; max_chain: number; cascade_points: number; replay_log_key: string | null;
  }>();

  // Determine if new score is better
  let isBetter = true;
  if (existing) {
    if (data.mode === 'sprint') {
      isBetter = data.score > existing.score;
    } else if (data.mode === 'clear') {
      // Clear: fewer moves is better; new clear beats non-clear; same moves → higher score
      if (data.isCleared && !existing.is_cleared) {
        isBetter = true;
      } else if (!data.isCleared && existing.is_cleared) {
        isBetter = false;
      } else if (data.isCleared && existing.is_cleared) {
        isBetter = data.moveCount < existing.move_count
          || (data.moveCount === existing.move_count && data.score > existing.score);
      } else {
        isBetter = false; // both failed, keep existing
      }
    } else if (data.mode === 'cascade') {
      // Cascade: higher cascade points is better; same points → higher score
      isBetter = data.cascadePoints > (existing.cascade_points ?? 0)
        || (data.cascadePoints === (existing.cascade_points ?? 0) && data.score > existing.score);
    } else {
      // Survival: more moves is better; same moves → higher score
      isBetter = data.moveCount > existing.move_count
        || (data.moveCount === existing.move_count && data.score > existing.score);
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
        `INSERT INTO play_scores (id, user_id, seed_id, mode, move_limit, move_count, score, is_cleared, max_chain, cascade_points, replay_log_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        scoreId, userId, seed.id, data.mode,
        data.moveLimit ?? null, data.moveCount, data.score,
        data.isCleared ? 1 : 0, data.maxChain, data.cascadePoints, replayLogKey
      ).run(),
    ]);
  } else if (isBetter) {
    const replayLogKey = `replays/${userId}/${seed.id}/${generateId()}.json`;
    scoreId = existing.id;
    await Promise.all([
      c.env.R2.put(replayLogKey, JSON.stringify(data.replayLog)),
      c.env.DB.prepare(
        `UPDATE play_scores SET move_limit = ?, move_count = ?, score = ?, is_cleared = ?, max_chain = ?, cascade_points = ?, replay_log_key = ?
         WHERE id = ?`
      ).bind(
        data.moveLimit ?? null, data.moveCount, data.score,
        data.isCleared ? 1 : 0, data.maxChain, data.cascadePoints, replayLogKey,
        scoreId
      ).run(),
    ]);
  } else {
    scoreId = existing.id;
  }

  // Invalidate ranking cache + evaluate achievements in parallel
  let newAchievements: string[] = [];
  try {
    const [, achievements] = await Promise.all([
      c.env.KV.delete(`ranking:${seed.id}:${data.mode}`),
      evaluateAchievements(c.env.DB, userId, {
        mode: data.mode,
        score: data.score,
        moveCount: data.moveCount,
        isCleared: data.isCleared,
        date: data.date,
        maxChain: data.maxChain,
        cascadePoints: data.cascadePoints,
        generatedItemTypes: data.generatedItemTypes,
      }),
    ]);
    newAchievements = achievements;
  } catch {
    // Achievement evaluation failure should not break score submission
  }

  return c.json({ scoreId, shareCode: seed.share_code, newAchievements }, 201);
});

// GET /api/scores/my - Get user's play history
scoreRoutes.get('/my', async (c) => {
  const userId = c.get('userId');
  const seedId = c.req.query('seedId');

  let query = `SELECT ps.id, ps.seed_id, s.seed_value, ps.mode, ps.move_limit, ps.move_count, ps.score, ps.is_cleared, ps.created_at
    FROM play_scores ps
    JOIN puzzle_seeds s ON s.id = ps.seed_id
    WHERE ps.user_id = ?`;
  const params: unknown[] = [userId];

  if (seedId) {
    query += ' AND ps.seed_id = ?';
    params.push(seedId);
  }
  query += ' ORDER BY ps.created_at DESC LIMIT 200';

  const scores = await c.env.DB.prepare(query).bind(...params).all<{
    id: string; seed_id: string; seed_value: string; mode: string;
    move_limit: number | null; move_count: number; score: number;
    is_cleared: number; created_at: string;
  }>();

  return c.json({
    scores: (scores.results ?? []).map((s) => ({
      id: s.id,
      seedId: s.seed_id,
      seedValue: Number(s.seed_value),
      mode: s.mode,
      moveLimit: s.move_limit,
      moveCount: s.move_count,
      score: s.score,
      isCleared: !!s.is_cleared,
      createdAt: s.created_at,
    })),
  });
});

// GET /api/scores/:scoreId/replay - Get replay data for a score
// Past daily puzzles: public (any user can view). Today's puzzles: own scores only.
scoreRoutes.get('/:scoreId/replay', async (c) => {
  const userId = c.get('userId');
  const scoreId = c.req.param('scoreId');

  const score = await c.env.DB.prepare(
    `SELECT ps.replay_log_key, ps.mode, ps.move_limit, ps.score as final_score, ps.cascade_points,
            ps.user_id, s.seed_value, s.daily_date, u.display_name
     FROM play_scores ps
     JOIN puzzle_seeds s ON s.id = ps.seed_id
     LEFT JOIN users u ON u.id = ps.user_id
     WHERE ps.id = ?`
  ).bind(scoreId).first<{
    replay_log_key: string | null; mode: string; move_limit: number | null;
    final_score: number; cascade_points: number; seed_value: string;
    user_id: string; daily_date: string | null; display_name: string | null;
  }>();

  if (!score) return c.json({ error: 'Not found' }, 404);

  // Access control: past dates are public, today is own-only
  const isPast = score.daily_date != null && score.daily_date < todayJST();
  if (!isPast && score.user_id !== userId) {
    return c.json({ error: 'Not found' }, 404);
  }

  if (!score.replay_log_key) return c.json({ error: 'No replay data' }, 404);

  const obj = await c.env.R2.get(score.replay_log_key);
  if (!obj) return c.json({ error: 'Replay not found' }, 404);

  const replayLog = JSON.parse(await obj.text());

  if (!Array.isArray(replayLog) || replayLog.length === 0) {
    return c.json({ error: 'No replay data' }, 404);
  }

  return c.json({
    replayLog,
    seed: Number(score.seed_value),
    mode: score.mode,
    moveLimit: score.move_limit,
    finalScore: score.final_score,
    cascadePoints: score.cascade_points,
    displayName: score.display_name ?? 'NO NAME',
  });
});
