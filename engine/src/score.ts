import { Match } from './types.js';
import { getUniquePositions } from './match.js';

const BASE_POINTS_PER_TILE = 10;
const SIMULTANEOUS_BONUS = 30;
const FULL_CLEAR_BONUS = 1000;

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
