/** 1 回のプレイの結果のうち、ベストの比較に使う値 */
export interface ResultSummary {
  isCleared: boolean;
  moves: number;
  score: number;
}

/**
 * a が b より良い結果か。サーバーがベストを置き換える条件（backend/src/routes/scores.ts の BETTER_THAN_STORED）と同じ:
 * クリアした記録を優先し、どちらもクリアなら少ない手数、同じ手数なら高いスコア
 */
export function isBetterResult(a: ResultSummary, b: ResultSummary): boolean {
  if (a.isCleared !== b.isCleared) return a.isCleared;
  if (!a.isCleared) return false;
  if (a.moves !== b.moves) return a.moves < b.moves;
  return a.score > b.score;
}
