/** 1 回のプレイの結果のうち、ベストの比較に使う値 */
export interface ResultSummary {
  isCleared: boolean;
  moves: number;
  /** クリアした時点のその日の累計プレイ時間。時間の記録がない（古い）記録は null */
  timeMs: number | null;
}

/**
 * a が b より良い結果か。サーバーがベストを置き換える条件（backend/src/lib/ranking-rule.ts の BETTER_THAN_STORED）と同じ:
 * クリアした記録を優先し、どちらもクリアなら少ない手数、同じ手数なら短い時間（時間の記録がないものは最も遅い扱い）
 */
export function isBetterResult(a: ResultSummary, b: ResultSummary): boolean {
  if (a.isCleared !== b.isCleared) return a.isCleared;
  if (!a.isCleared) return false;
  if (a.moves !== b.moves) return a.moves < b.moves;
  if (a.timeMs === null) return false;
  return b.timeMs === null || a.timeMs < b.timeMs;
}
