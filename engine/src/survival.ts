/**
 * Survivalモード: スコアノルマテーブルとチェックポイント判定
 *
 * 5手ごとに区間ノルマを判定。各区間の開始時にスコアがリセットされ、
 * その区間内で稼いだスコアのみでノルマをクリアする必要がある。
 */

/** デフォルトのノルマテーブル（各区間のノルマ値）
 * 区間0: 300, 区間1: 400, 区間2: 500, ...（+100ずつ増加）
 */
export const DEFAULT_QUOTA_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 20; n++) {
    table.push(300 + 100 * n);
  }
  return table;
})();

/** ノルマ値を取得（テーブル範囲外は外挿） */
export function getQuota(table: number[], checkpointIndex: number): number {
  if (checkpointIndex < table.length) return table[checkpointIndex];
  // 外挿: 最後の差分を維持して増加
  const lastDiff = table.length >= 2
    ? table[table.length - 1] - table[table.length - 2]
    : 100;
  return table[table.length - 1] + lastDiff * (checkpointIndex - table.length + 1);
}

/** Survivalモードのノルマチェック
 * 5手ごと（moveCount % 5 === 0 かつ moveCount > 0）にチェックポイント
 * segmentScore: 現区間で稼いだスコア（= score - segmentStartScore）
 */
export function checkSurvivalQuota(
  moveCount: number,
  segmentScore: number,
  quotaTable: number[],
): { isCheckpoint: boolean; quotaMet: boolean; checkpointIndex: number } {
  if (moveCount === 0 || moveCount % 5 !== 0) {
    return { isCheckpoint: false, quotaMet: true, checkpointIndex: -1 };
  }
  const checkpointIndex = (moveCount / 5) - 1;
  const quota = getQuota(quotaTable, checkpointIndex);
  return {
    isCheckpoint: true,
    quotaMet: segmentScore >= quota,
    checkpointIndex,
  };
}
