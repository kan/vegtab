import { Cell, ItemType, Match, BOARD_SIZE } from './types.js';
import { getUniquePositions } from './match.js';

const BASE_POINTS_PER_TILE = 10;
const SIMULTANEOUS_BONUS = 30;
const FULL_CLEAR_BONUS = 1000;

const REMAINING_ITEM_BONUS: Record<ItemType, number> = {
  scope: 50,
  v_cut: 150,
  h_cut: 150,
  burst: 300,
  flush: 500,
};

/** 1連鎖ステップのスコアを計算 */
export function calculateStepScore(
  matches: Match[],
  chainIndex: number
): number {
  const totalTiles = getUniquePositions(matches).length;
  const baseScore = BASE_POINTS_PER_TILE * totalTiles * chainIndex;
  const simultaneousBonus = matches.length > 1
    ? (matches.length - 1) * SIMULTANEOUS_BONUS
    : 0;
  return baseScore + simultaneousBonus;
}

/** コーヒー×コーヒー全消しボーナス */
export function getFullClearBonus(): number {
  return FULL_CLEAR_BONUS;
}

/** Sprintモード終了時の残存アイテムボーナスを計算 */
export function calculateRemainingItemBonus(board: (Cell | null)[][]): number {
  let bonus = 0;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = board[row][col];
      if (cell?.item) {
        bonus += REMAINING_ITEM_BONUS[cell.item];
      }
    }
  }
  return bonus;
}
