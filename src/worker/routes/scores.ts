import { BOARD_SIZE, type Direction, type Position, type ReplayAction } from '../../core';
import type { AccountRequest, Route } from '../router';
import { json, readJsonBody } from '../lib/http';
import { isIntegerIn, isRecord, isStringOfLength, parseArray } from '../lib/validate';
import { generateId } from '../lib/id';
import { isDateNearToday, isRankingClosed } from '../lib/date';
import { findOrCreateDailySeed } from '../lib/seed';
import { evaluateAchievements } from '../lib/achievements';
import { verifyReplay } from '../lib/replay-verify';
import { MODE } from '../lib/mode';
import { newReplayKey } from '../lib/replay-key';
import { invalidateRankings } from '../lib/profile';
import { rateLimited, takeRateLimitSlot } from '../lib/rate-limit';
import {
  MAX_CLEAR_TIME_MS, BETTER_THAN_STORED, PUBLIC_NAME, publicNameJoins,
} from '../lib/ranking-rule';

/**
 * Upper bound on replay length. Clear has no move limit (it ends on clearing or a stuck board),
 * so this is a generous cap well above any real run, not a game rule
 */
const MAX_REPLAY_ACTIONS = 1000;
const MAX_SCORE_BODY_BYTES = 256 * 1024;

const DIRECTIONS: readonly unknown[] = ['up', 'down', 'left', 'right'] satisfies Direction[];

function parsePosition(value: unknown): Position | undefined {
  if (!isRecord(value)) return undefined;
  const { row, col } = value;
  if (!isIntegerIn(row, 0, BOARD_SIZE - 1) || !isIntegerIn(col, 0, BOARD_SIZE - 1)) return undefined;
  return { row, col };
}

function parseDirection(value: unknown): Direction | undefined {
  return DIRECTIONS.includes(value) ? value as Direction : undefined;
}

/** A replay action rebuilt from the fields of its type: the stored log holds nothing else */
function parseReplayAction(value: unknown): ReplayAction | undefined {
  if (!isRecord(value)) return undefined;
  const targetCells = () => parseArray(value.targetCells, 0, 3, parsePosition);
  switch (value.type) {
    case 'swap': {
      const pos = parsePosition(value.pos);
      const dir = parseDirection(value.dir);
      return pos && dir ? { type: 'swap', pos, dir } : undefined;
    }
    case 'tap': {
      const pos = parsePosition(value.pos);
      return pos ? { type: 'tap', pos } : undefined;
    }
    case 'scope': {
      const pos = parsePosition(value.pos);
      const cells = targetCells();
      return pos && cells ? { type: 'scope', pos, targetCells: cells } : undefined;
    }
    case 'scope_synthesis': {
      const pos1 = parsePosition(value.pos1);
      const pos2 = parsePosition(value.pos2);
      const cells = targetCells();
      return pos1 && pos2 && cells ? { type: 'scope_synthesis', pos1, pos2, targetCells: cells } : undefined;
    }
    case 'scope_swap': {
      const pos = parsePosition(value.pos);
      const dir = parseDirection(value.dir);
      const cells = targetCells();
      return pos && dir && cells ? { type: 'scope_swap', pos, dir, targetCells: cells } : undefined;
    }
    default:
      return undefined;
  }
}

interface ScoreSubmission {
  date: string;
  /** null: no time, including a time over MAX_CLEAR_TIME_MS */
  clearTimeMs: number | null;
  generatedItemTypes: string[];
  replayLog: ReplayAction[];
}

/**
 * The body of POST /api/scores. Client-reported score/moveCount/etc. are intentionally not read:
 * every result is re-simulated from the replay log. The clear time is the one exception: it cannot
 * be verified from the replay and is accepted as reported (docs/DATA_CONTRACT.md「POST /api/scores」)
 */
function parseScoreSubmission(body: unknown): ScoreSubmission | undefined {
  if (!isRecord(body)) return undefined;
  const { date, mode, clearTimeMs } = body;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || mode !== MODE) return undefined;
  // Over the cap is stored as "no time" instead of rejecting the run (a late-day or past-day run must not fail)
  if (clearTimeMs != null && !isIntegerIn(clearTimeMs, 0, Number.MAX_SAFE_INTEGER)) return undefined;
  const generatedItemTypes = body.generatedItemTypes === undefined
    ? []
    : parseArray(body.generatedItemTypes, 0, 10, (v) => isStringOfLength(v, 0, 20) ? v : undefined);
  const replayLog = parseArray(body.replayLog, 1, MAX_REPLAY_ACTIONS, parseReplayAction);
  if (!generatedItemTypes || !replayLog) return undefined;
  return {
    date,
    clearTimeMs: clearTimeMs == null || clearTimeMs > MAX_CLEAR_TIME_MS ? null : clearTimeMs,
    generatedItemTypes,
    replayLog,
  };
}

// POST /api/scores - Submit a score
async function postScore({ request, env, accountId: userId }: AccountRequest): Promise<Response> {
  const data = await readJsonBody(request, parseScoreSubmission, MAX_SCORE_BODY_BYTES);
  if (data instanceof Response) return data;

  // Today (JST) or a past calendar play within 60 days
  if (!isDateNearToday(data.date)) {
    return json({ error: 'invalid_date' }, 400);
  }

  // Find or create the daily seed
  const seed = await findOrCreateDailySeed(env.DB, env.DAILY_SEED_SECRET, data.date);

  // Past dates: allow play but don't record to ranking (yesterday is still recorded shortly after midnight)
  if (isRankingClosed(data.date)) {
    return json({ scoreId: null, shareCode: seed.share_code, newAchievements: [], pastDate: true }, 200);
  }

  // The per-ID limit is taken before the replay is verified (the costly part)
  const limited = await takeRateLimitSlot(env.DB, userId, 'score');
  if (limited) return rateLimited(limited);

  // Replay verification: the result is always re-simulated from the replay log
  const verified = verifyReplay(Number(seed.seed_value), data.replayLog);
  if (!verified.valid) {
    return json({ error: 'invalid_replay' }, 400);
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
  const stored = await env.DB.prepare(
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
    const replayLogKey = newReplayKey(userId, seed.id);
    await env.R2.put(replayLogKey, JSON.stringify(data.replayLog));

    // One statement keeps concurrent first submissions from creating duplicate rows:
    // insert, or replace the stored best only when the new result is still better.
    // move_limit and cascade_points (removed modes) are left to their column defaults
    const upserted = await env.DB.prepare(
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
      await env.R2.delete(replayLogKey);
      throw e;
    });

    if (upserted) {
      scoreId = upserted.id;
      await Promise.all([
        // Invalidate the ranking cache only after the DB write has committed
        invalidateRankings(env, [seed.id]),
        // The row now points at the new object, so the replaced best's replay is unreferenced
        stored?.replay_log_key ? env.R2.delete(stored.replay_log_key) : undefined,
      ]);
    } else {
      // A concurrent submission stored a better result in between: keep it and drop ours
      await env.R2.delete(replayLogKey);
      const current = await env.DB.prepare(
        'SELECT id FROM play_scores WHERE user_id = ? AND seed_id = ? AND mode = ?'
      ).bind(userId, seed.id, MODE).first<{ id: string }>();
      scoreId = current!.id;
    }
  }

  // Evaluate achievements separately so failure doesn't affect cache invalidation
  let newAchievements: string[] = [];
  try {
    newAchievements = await evaluateAchievements(env.DB, userId, {
      moveCount: verifiedMoveCount,
      isCleared: verifiedIsCleared,
      maxChain: verifiedMaxChain,
      generatedItemTypes: data.generatedItemTypes,
    });
  } catch {
    // Achievement evaluation failure should not break score submission
  }

  return json({ scoreId, shareCode: seed.share_code, newAchievements, verifiedScore, verifiedMoveCount }, 201);
}

// GET /api/scores/my - Get user's play history
async function getMyScores({ env, url, accountId: userId }: AccountRequest): Promise<Response> {
  const seedId = url.searchParams.get('seedId');

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

  const scores = await env.DB.prepare(query).bind(...params).all<{
    id: string; seed_id: string; seed_value: string; mode: string;
    move_count: number; score: number;
    is_cleared: number; clear_time_ms: number | null; created_at: string;
  }>();

  return json({
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
}

// GET /api/scores/:scoreId/replay - Get replay data for a score
// Daily puzzles whose ranking is closed: public (any user can view). Open rankings: own scores only.
async function getReplay({ env, params, accountId: userId }: AccountRequest): Promise<Response> {
  const { scoreId } = params;

  const score = await env.DB.prepare(
    `SELECT ps.replay_log_key, ps.score as final_score,
            ps.user_id, s.seed_value, s.daily_date, ${PUBLIC_NAME} AS display_name
     FROM play_scores ps
     JOIN puzzle_seeds s ON s.id = ps.seed_id
     ${publicNameJoins('ps')}
     WHERE ps.id = ? AND ps.mode = ?`
  ).bind(scoreId, MODE).first<{
    replay_log_key: string | null; final_score: number; seed_value: string;
    user_id: string; daily_date: string | null; display_name: string | null;
  }>();

  if (!score) return json({ error: 'not_found' }, 404);

  // Access control: closed rankings are public, open ones are own-only
  const rankingClosed = score.daily_date != null && isRankingClosed(score.daily_date);
  if (!rankingClosed && score.user_id !== userId) {
    return json({ error: 'not_found' }, 404);
  }

  if (!score.replay_log_key) return json({ error: 'no_replay' }, 404);

  const obj = await env.R2.get(score.replay_log_key);
  if (!obj) return json({ error: 'no_replay' }, 404);

  const replayLog = JSON.parse(await obj.text());

  if (!Array.isArray(replayLog) || replayLog.length === 0) {
    return json({ error: 'no_replay' }, 404);
  }

  return json({
    replayLog,
    seed: Number(score.seed_value),
    finalScore: score.final_score,
    displayName: score.display_name ?? 'NO NAME',
  });
}

export const scoreRoutes: Route<AccountRequest>[] = [
  { method: 'POST', path: '/api/scores', handler: postScore },
  { method: 'GET', path: '/api/scores/my', handler: getMyScores },
  { method: 'GET', path: '/api/scores/:scoreId/replay', handler: getReplay },
];
