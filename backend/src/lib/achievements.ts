import { ACHIEVEMENT_DEFS, isUnlocked } from './achievement-defs';

export interface ScoreData {
  mode: string;
  score: number;
  moveCount: number;
  isCleared: boolean;
  date: string;
  maxChain: number;
  generatedItemTypes: string[];
}

/**
 * Evaluate achievements after a score submission.
 * Returns the list of newly unlocked achievement types.
 */
export async function evaluateAchievements(
  db: D1Database,
  userId: string,
  data: ScoreData,
): Promise<string[]> {
  // Compute candidate values for each achievement based on this score
  const candidates = computeCandidates(data);

  // Run cumulative queries and existing-achievements fetch in parallel
  const [cumulativeCandidates, existing] = await Promise.all([
    computeCumulativeCandidates(db, userId, data),
    db.prepare(
      'SELECT achievement_type, current_value, is_unlocked FROM achievements WHERE user_id = ?'
    ).bind(userId).all<{ achievement_type: string; current_value: number; is_unlocked: number }>(),
  ]);
  Object.assign(candidates, cumulativeCandidates);

  const existingMap = new Map(
    (existing.results ?? []).map(r => [r.achievement_type, r])
  );

  const newlyUnlocked: string[] = [];
  const statements: D1PreparedStatement[] = [];

  for (const def of ACHIEVEMENT_DEFS) {
    const candidateValue = candidates[def.type];
    if (candidateValue === undefined) continue;

    const prev = existingMap.get(def.type);

    // Determine the best current_value to store
    let bestValue: number;
    if (def.comparator === 'lte') {
      // Lower is better (clear_under_*)
      bestValue = prev && prev.current_value > 0
        ? Math.min(prev.current_value, candidateValue)
        : candidateValue;
    } else {
      // Higher is better
      bestValue = prev ? Math.max(prev.current_value, candidateValue) : candidateValue;
    }

    const wasUnlocked = prev?.is_unlocked === 1;
    const nowUnlocked = isUnlocked(def, bestValue);

    if (!prev) {
      statements.push(
        db.prepare(
          `INSERT INTO achievements (id, user_id, achievement_type, current_value, is_unlocked, unlocked_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          crypto.randomUUID(), userId, def.type, bestValue,
          nowUnlocked ? 1 : 0, nowUnlocked ? new Date().toISOString() : null,
        )
      );
      if (nowUnlocked) newlyUnlocked.push(def.type);
    } else if (bestValue !== prev.current_value || (!wasUnlocked && nowUnlocked)) {
      statements.push(
        db.prepare(
          `UPDATE achievements SET current_value = ?, is_unlocked = ?, unlocked_at = COALESCE(unlocked_at, ?)
           WHERE user_id = ? AND achievement_type = ?`
        ).bind(
          bestValue, nowUnlocked ? 1 : 0,
          nowUnlocked ? new Date().toISOString() : null,
          userId, def.type,
        )
      );
      if (!wasUnlocked && nowUnlocked) newlyUnlocked.push(def.type);
    }
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }

  return newlyUnlocked;
}

function computeCandidates(data: ScoreData): Record<string, number> {
  const c: Record<string, number> = {};

  if (data.mode === 'sprint') {
    c['sprint_score_500'] = data.score;
    c['sprint_score_1000'] = data.score;
    c['sprint_score_2000'] = data.score;
    c['sprint_score_5000'] = data.score;
  }

  // Chain achievements — evaluated across all modes
  c['cascade_chain_3'] = data.maxChain;
  c['cascade_chain_5'] = data.maxChain;
  c['cascade_chain_10'] = data.maxChain;
  c['cascade_chain_15'] = data.maxChain;

  if (data.mode === 'clear') {
    if (data.isCleared) {
      c['clear_first'] = 1;
      c['clear_under_10'] = data.moveCount;
      c['clear_under_7'] = data.moveCount;
    }
  }

  if (data.mode === 'survival') {
    c['survival_moves_20'] = data.moveCount;
    c['survival_moves_50'] = data.moveCount;
    c['survival_moves_100'] = data.moveCount;
    c['survival_moves_200'] = data.moveCount;
  }

  // all_items_generated: 5 unique types = scope, v_cut, h_cut, burst, flush
  if (data.generatedItemTypes.length >= 5) {
    const unique = new Set(data.generatedItemTypes);
    if (unique.size >= 5) c['all_items_generated'] = 1;
  }

  return c;
}

async function computeCumulativeCandidates(
  db: D1Database, userId: string, data: ScoreData,
): Promise<Record<string, number>> {
  const c: Record<string, number> = {};

  // Run both queries in parallel
  const [dayResult, modesResult] = await Promise.all([
    db.prepare(
      `SELECT COUNT(DISTINCT date(created_at)) as days FROM play_scores WHERE user_id = ?`
    ).bind(userId).first<{ days: number }>(),
    db.prepare(
      `SELECT DISTINCT ps.mode FROM play_scores ps
       JOIN puzzle_seeds s ON s.id = ps.seed_id
       WHERE ps.user_id = ? AND s.daily_date = ?`
    ).bind(userId, data.date).all<{ mode: string }>(),
  ]);

  const days = dayResult?.days ?? 0;
  c['play_days_3'] = days;
  c['play_days_7'] = days;
  c['play_days_30'] = days;

  const modes = new Set((modesResult.results ?? []).map(r => r.mode));
  modes.add(data.mode); // Include current submission
  if (modes.size >= 3) c['all_modes_played'] = 1;

  return c;
}
