import { ACHIEVEMENT_DEFS, isUnlocked, type AchievementMetric } from '@vegtab/engine';

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
    const candidateValue = candidates[def.metric];
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

/** Values this score yields, per metric. A metric left out is not evaluated for this submission */
type Candidates = Partial<Record<AchievementMetric, number>>;

function computeCandidates(data: ScoreData): Candidates {
  const c: Candidates = { maxChain: data.maxChain };

  if (data.isCleared) {
    c.cleared = 1;
    c.clearMoves = data.moveCount;
  }

  // 5 unique types = scope, v_cut, h_cut, burst, flush
  if (new Set(data.generatedItemTypes).size >= 5) c.allItems = 1;

  return c;
}

async function computeCumulativeCandidates(db: D1Database, userId: string): Promise<Candidates> {
  // Rows of removed modes stay in D1 and are counted too: those days were played, and the stored
  // current_value was computed from all rows, so counting only Clear rows would stall progress
  const dayResult = await db.prepare(
    `SELECT COUNT(DISTINCT date(created_at)) as days FROM play_scores WHERE user_id = ?`
  ).bind(userId).first<{ days: number }>();

  return { playDays: dayResult?.days ?? 0 };
}
