/**
 * Cascadeモード: 連鎖ポテンシャル計算
 *
 * 現在の盤面で有効な全スワイプ候補をシミュレートし、
 * 最大到達連鎖数を返す。UI表示専用で、ゲーム状態には影響しない。
 */
import { GameState, Position, Direction, BOARD_SIZE } from './types.js';
import { processAction } from './engine.js';
import { getScopeAdjacentTargets } from './item.js';

const SWAP_DIRS: { dir: Direction; dr: number; dc: number }[] = [
  { dir: 'right', dr: 0, dc: 1 },
  { dir: 'down', dr: 1, dc: 0 },
];

/**
 * 盤面の全有効スワイプ・scopeタップを試算し、最大到達連鎖数を返す。
 * processAction が内部で cloneGameState するため、入力 state は変更されない。
 */
export function computeMaxChainPotential(state: GameState): number {
  if (state.isGameOver) return 0;

  const board = state.board;
  let maxChain = 0;

  // 1. 全スワイプ探索
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      for (const { dir, dr, dc } of SWAP_DIRS) {
        if (r + dr >= BOARD_SIZE || c + dc >= BOARD_SIZE) continue;
        const newState = processAction(state, { type: 'swap', pos: { row: r, col: c }, dir });
        if (newState !== state && (newState.lastChainCount ?? 0) > maxChain) {
          maxChain = newState.lastChainCount!;
        }
      }
    }
  }

  // 2. scopeタップ探索
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = board[r][c];
      if (cell?.item === 'scope' && !cell.obstacle) {
        const pos: Position = { row: r, col: c };
        const adjTargets = getScopeAdjacentTargets(board, pos);
        // obstacle優先、なければ非obstacleの隣接セルを選ぶ
        const obstacle = adjTargets.find(t => board[t.row][t.col]?.obstacle);
        const targetCells: Position[] = [];
        if (obstacle) {
          targetCells.push(obstacle);
        } else {
          const nonObstacle = adjTargets.find(t => !board[t.row][t.col]?.obstacle);
          if (nonObstacle) targetCells.push(nonObstacle);
        }
        if (targetCells.length > 0) {
          const newState = processAction(state, { type: 'scope', pos, targetCells });
          if (newState !== state && (newState.lastChainCount ?? 0) > maxChain) {
            maxChain = newState.lastChainCount!;
          }
        }
      }
    }
  }

  return maxChain;
}
