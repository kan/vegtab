import { ACHIEVEMENT_DEFS, isUnlocked } from '@vegtab/engine';

/** A verified Clear result */
export interface ScoreData {
  moveCount: number;
  isCleared: boolean;
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
    computeCumulativeCandidates(db, userId),
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

  // Chain achievements (type names date from the removed Cascade mode; kept to match stored rows)
  c['cascade_chain_3'] = data.maxChain;
  c['cascade_chain_5'] = data.maxChain;
  c['cascade_chain_10'] = data.maxChain;
  c['cascade_chain_15'] = data.maxChain;

  if (data.isCleared) {
    c['clear_first'] = 1;
    c['clear_under_10'] = data.moveCount;
    c['clear_under_7'] = data.moveCount;
  }

  // all_items_generated: 5 unique types = scope, v_cut, h_cut, burst, flush
  if (data.generatedItemTypes.length >= 5) {
    const unique = new Set(data.generatedItemTypes);
    if (unique.size >= 5) c['all_items_generated'] = 1;
  }

  return c;
}

async function computeCumulativeCandidates(
  db: D1Database, userId: string,
): Promise<Record<string, number>> {
  const c: Record<string, number> = {};

  // Rows of removed modes stay in D1 and are counted too: those days were played, and the stored
  // current_value was computed from all rows, so counting only Clear rows would stall progress
  const dayResult = await db.prepare(
    `SELECT COUNT(DISTINCT date(created_at)) as days FROM play_scores WHERE user_id = ?`
  ).bind(userId).first<{ days: number }>();

  const days = dayResult?.days ?? 0;
  c['play_days_3'] = days;
  c['play_days_7'] = days;
  c['play_days_30'] = days;

  return c;
}
