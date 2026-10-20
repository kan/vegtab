import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { BOARD_SIZE, type ReplayAction } from '@vegtab/engine';
import type { Bindings, Variables } from '../types';
import { generateId } from '../lib/id';
import { isDateNearToday, isRankingClosed } from '../lib/date';
import { findOrCreateDailySeed } from '../lib/seed';
import { evaluateAchievements } from '../lib/achievements';
import { verifyReplay } from '../lib/replay-verify';
import { MODE } from '../lib/mode';
import { MAX_CLEAR_TIME_MS, BETTER_THAN_STORED, rankingCacheKey } from '../lib/ranking-rule';

/**
 * Upper bound on replay length. Clear has no move limit (it ends on clearing or a stuck board),
 * so this is a generous cap well above any real run, not a game rule
 */
const MAX_REPLAY_ACTIONS = 1000;
const MAX_SCORE_BODY_BYTES = 256 * 1024;

const positionSchema = z.object({
  row: z.number().int().min(0).max(BOARD_SIZE - 1),
  col: z.number().int().min(0).max(BOARD_SIZE - 1),
});
const directionSchema = z.enum(['up', 'down', 'left', 'right']);
const targetCellsSchema = z.array(positionSchema).max(3);

const replayActionSchema: z.ZodType<ReplayAction> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('swap'), pos: positionSchema, dir: directionSchema }),
  z.object({ type: z.literal('tap'), pos: positionSchema }),
  z.object({ type: z.literal('scope'), pos: positionSchema, targetCells: targetCellsSchema }),
  z.object({ type: z.literal('scope_synthesis'), pos1: positionSchema, pos2: positionSchema, targetCells: targetCellsSchema }),
  z.object({ type: z.literal('scope_swap'), pos: positionSchema, dir: directionSchema, targetCells: targetCellsSchema }),
]);

// Client-reported score/moveCount/etc. are intentionally not part of the schema:
// every result is re-simulated from the replay log. The clear time is the one exception: it cannot
// be verified from the replay and is accepted as reported (SPEC §5.3)
const submitScoreSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.literal(MODE),
  // Over the cap is stored as "no time" instead of rejecting the run (a late-day or past-day run must not fail)
  clearTimeMs: z.number().int().min(0).nullable().optional()
    .transform(v => (v == null || v > MAX_CLEAR_TIME_MS ? null : v)),
  generatedItemTypes: z.array(z.string().max(20)).max(10).optional().default([]),
  replayLog: z.array(replayActionSchema).min(1).max(MAX_REPLAY_ACTIONS),
});

export const scoreRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// POST /api/scores - Submit a score
scoreRoutes.post('/', bodyLimit({
  maxSize: MAX_SCORE_BODY_BYTES,
  onError: (c) => c.json({ error: 'Payload too large' }, 413),
}), zValidator('json', submitScoreSchema), async (c) => {
  const userId = c.get('userId');
  const data = c.req.valid('json');

  // Today (JST) or a past calendar play within 60 days
  if (!isDateNearToday(data.date)) {
    return c.json({ error: 'Invalid date' }, 400);
  }

  // Find or create the daily seed
  const seed = await findOrCreateDailySeed(c.env.DB, data.date);

  // Past dates: allow play but don't record to ranking (yesterday is still recorded shortly after midnight)
  if (isRankingClosed(data.date)) {
    return c.json({ scoreId: null, shareCode: seed.share_code, newAchievements: [], pastDate: true }, 200);
  }

  // Replay verification: the result is always re-simulated from the replay log
  const verified = verifyReplay(Number(seed.seed_value), data.replayLog);
  if (!verified.valid) {
    return c.json({ error: 'Invalid replay' }, 400);
  }
  const {
    score: verifiedScore,
    moveCount: verifiedMoveCount,
    isCleared: verifiedIsCleared,
    maxChain: verifiedMaxChain,
  } = verified;

  const isCleared = verifiedIsCleared ? 1 : 0;
  // Only a cleared run has a clear time
  const clearTimeMs = verifiedIsCleared ? data.clearTimeMs : null;

  // Most submissions do not beat the stored best; those are answered without touching R2
  const stored = await c.env.DB.prepare(
    `SELECT play_scores.id, play_scores.replay_log_key, (${BETTER_THAN_STORED}) AS better
     FROM play_scores, (SELECT ? AS move_count, ? AS is_cleared, ? AS clear_time_ms) AS excluded
     WHERE play_scores.user_id = ? AND play_scores.seed_id = ? AND play_scores.mode = ?`
  ).bind(
    verifiedMoveCount, isCleared, clearTimeMs, userId, seed.id, MODE,
  ).first<{ id: string; replay_log_key: string | null; better: number }>();

  let scoreId: string;
  if (stored && !stored.better) {
    scoreId = stored.id;
  } else {
    // Write the replay log first so a stored row never points at a missing object
    const replayLogKey = `replays/${userId}/${seed.id}/${generateId()}.json`;
    await c.env.R2.put(replayLogKey, JSON.stringify(data.replayLog));

    // One statement keeps concurrent first submissions from creating duplicate rows:
    // insert, or replace the stored best only when the new result is still better.
    // move_limit and cascade_points (removed modes) are left to their column defaults
    const upserted = await c.env.DB.prepare(
      `INSERT INTO play_scores (id, user_id, seed_id, mode, move_count, score, is_cleared, clear_time_ms, max_chain, replay_log_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, seed_id, mode) DO UPDATE SET
         move_count = excluded.move_count, score = excluded.score,
         is_cleared = excluded.is_cleared, clear_time_ms = excluded.clear_time_ms, max_chain = excluded.max_chain,
         replay_log_key = excluded.replay_log_key
       WHERE ${BETTER_THAN_STORED}
       RETURNING id`
    ).bind(
      generateId(), userId, seed.id, MODE,
      verifiedMoveCount, verifiedScore, isCleared, clearTimeMs, verifiedMaxChain, replayLogKey
    ).first<{ id: string }>().catch(async (e) => {
      await c.env.R2.delete(replayLogKey);
      throw e;
    });

    if (upserted) {
      scoreId = upserted.id;
      await Promise.all([
        // Invalidate the ranking cache only after the DB write has committed
        c.env.KV.delete(rankingCacheKey(seed.id)),
        // The row now points at the new object, so the replaced best's replay is unreferenced
        stored?.replay_log_key ? c.env.R2.delete(stored.replay_log_key) : undefined,
      ]);
    } else {
      // A concurrent submission stored a better result in between: keep it and drop ours
      await c.env.R2.delete(replayLogKey);
      const current = await c.env.DB.prepare(
        'SELECT id FROM play_scores WHERE user_id = ? AND seed_id = ? AND mode = ?'
      ).bind(userId, seed.id, MODE).first<{ id: string }>();
      scoreId = current!.id;
    }
  }

  // Evaluate achievements separately so failure doesn't affect cache invalidation
  let newAchievements: string[] = [];
  try {
    newAchievements = await evaluateAchievements(c.env.DB, userId, {
      moveCount: verifiedMoveCount,
      isCleared: verifiedIsCleared,
      maxChain: verifiedMaxChain,
      generatedItemTypes: data.generatedItemTypes,
    });
  } catch {
    // Achievement evaluation failure should not break score submission
  }

  return c.json({ scoreId, shareCode: seed.share_code, newAchievements, verifiedScore, verifiedMoveCount }, 201);
});

// GET /api/scores/my - Get user's play history
scoreRoutes.get('/my', async (c) => {
  const userId = c.get('userId');
  const seedId = c.req.query('seedId');

  let query = `SELECT ps.id, ps.seed_id, s.seed_value, ps.mode, ps.move_count, ps.score, ps.is_cleared, ps.clear_time_ms, ps.created_at
    FROM play_scores ps
    JOIN puzzle_seeds s ON s.id = ps.seed_id
    WHERE ps.user_id = ? AND ps.mode = ?`;
  const params: unknown[] = [userId, MODE];

  if (seedId) {
    query += ' AND ps.seed_id = ?';
    params.push(seedId);
  }
  query += ' ORDER BY ps.created_at DESC LIMIT 200';

  const scores = await c.env.DB.prepare(query).bind(...params).all<{
    id: string; seed_id: string; seed_value: string; mode: string;
    move_count: number; score: number;
    is_cleared: number; clear_time_ms: number | null; created_at: string;
  }>();

  return c.json({
    scores: (scores.results ?? []).map((s) => ({
      id: s.id,
      seedId: s.seed_id,
      seedValue: Number(s.seed_value),
      mode: s.mode,
      moveCount: s.move_count,
      score: s.score,
      isCleared: !!s.is_cleared,
      clearTimeMs: s.clear_time_ms,
      createdAt: s.created_at,
    })),
  });
});

// GET /api/scores/:scoreId/replay - Get replay data for a score
// Daily puzzles whose ranking is closed: public (any user can view). Open rankings: own scores only.
scoreRoutes.get('/:scoreId/replay', async (c) => {
  const userId = c.get('userId');
  const scoreId = c.req.param('scoreId');

  const score = await c.env.DB.prepare(
    `SELECT ps.replay_log_key, ps.score as final_score,
            ps.user_id, s.seed_value, s.daily_date, u.display_name
     FROM play_scores ps
     JOIN puzzle_seeds s ON s.id = ps.seed_id
     LEFT JOIN users u ON u.id = ps.user_id
     WHERE ps.id = ? AND ps.mode = ?`
  ).bind(scoreId, MODE).first<{
    replay_log_key: string | null; final_score: number; seed_value: string;
    user_id: string; daily_date: string | null; display_name: string | null;
  }>();

  if (!score) return c.json({ error: 'Not found' }, 404);

  // Access control: closed rankings are public, open ones are own-only
  const rankingClosed = score.daily_date != null && isRankingClosed(score.daily_date);
  if (!rankingClosed && score.user_id !== userId) {
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
    finalScore: score.final_score,
    displayName: score.display_name ?? 'NO NAME',
  });
});
