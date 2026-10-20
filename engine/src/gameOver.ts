import { Cell, GameState, BOARD_SIZE } from './types.js';
import { findMatches } from './match.js';
import { cloneBoard } from './board.js';
import { allObstaclesCleared } from './obstacle.js';

/** 有効なスワイプが存在するかチェック */
export function hasValidSwap(board: (Cell | null)[][]): boolean {
  const directions: [number, number][] = [[0, 1], [1, 0]]; // 右と下のみチェック（逆方向は対称）

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = board[row][col];
      if (cell === null) continue;

      for (const [dr, dc] of directions) {
        const nr = row + dr;
        const nc = col + dc;
        if (nr >= BOARD_SIZE || nc >= BOARD_SIZE) continue;
        const neighbor = board[nr][nc];
        if (neighbor === null) continue;

        // おじゃま同士のスワイプは不可
        if (cell.obstacle && neighbor.obstacle) continue;

        // 片方がおじゃまタイルの場合
        if (cell.obstacle || neighbor.obstacle) {
          const nonObstacle = cell.obstacle ? neighbor : cell;
          // アイテム（scope以外）×おじゃま は常に有効（アイテム発動）
          if (nonObstacle.item && nonObstacle.item !== 'scope') return true;
          // 通常タイル×おじゃま: 入れ替えてマッチが成立するか
          if (!nonObstacle.item) {
            const testBoard = cloneBoard(board);
            testBoard[row][col] = { ...neighbor };
            testBoard[nr][nc] = { ...cell };
            if (findMatches(testBoard).length > 0) return true;
          }
          continue;
        }

        // アイテム同士のスワイプは常に有効（合成）
        if (cell.item && neighbor.item) return true;

        // アイテムとの入れ替えは有効
        if (cell.item || neighbor.item) return true;

        // 通常のタイル同士: 入れ替えてマッチが成立するか
        const testBoard = cloneBoard(board);
        testBoard[row][col] = { ...neighbor };
        testBoard[nr][nc] = { ...cell };
        if (findMatches(testBoard).length > 0) return true;
      }
    }
  }
  return false;
}

/** 盤上に起動可能なアイテムが存在するかチェック */
export function hasActivatableItems(board: (Cell | null)[][]): boolean {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = board[row][col];
      if (cell?.item) return true;
    }
  }
  return false;
}

/** 詰み判定 */
function isStuck(board: (Cell | null)[][]): boolean {
  return !hasValidSwap(board) && !hasActivatableItems(board);
}

/** ゲーム終了判定: 全おじゃまタイル除去でクリア、詰みで失敗 */
export function checkGameOverState(state: GameState): {
  gameOver: boolean;
  isCleared?: boolean;
} {
  if (allObstaclesCleared(state.board)) return { gameOver: true, isCleared: true };
  if (isStuck(state.board)) return { gameOver: true, isCleared: false };
  return { gameOver: false };
}
