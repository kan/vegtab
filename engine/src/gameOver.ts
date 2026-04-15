import { Cell, Direction, GameMode, GameState, Position, BOARD_SIZE } from './types.js';
import { findMatches } from './match.js';
import { cloneBoard } from './board.js';
import { allObstaclesCleared, hasObstacleWithMinDurability } from './obstacle.js';
import { SURVIVAL_MAX_OBSTACLE_DURABILITY } from './survival.js';

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

/** ゲーム終了判定（4モード対応） */
export function checkGameOverState(state: GameState): {
  gameOver: boolean;
  isCleared?: boolean;
} {
  const { board, mode, moveCount, moveLimit } = state;

  switch (mode) {
    case 'sprint':
    case 'cascade': {
      if (moveLimit !== undefined && moveCount >= moveLimit) return { gameOver: true };
      if (isStuck(board)) return { gameOver: true };
      return { gameOver: false };
    }
    case 'clear': {
      if (allObstaclesCleared(board)) return { gameOver: true, isCleared: true };
      if (isStuck(board)) return { gameOver: true, isCleared: false };
      return { gameOver: false };
    }
    case 'survival': {
      // (a) 耐久値が SURVIVAL_MAX_OBSTACLE_DURABILITY に到達したおじゃまタイルが存在する → 即死
      if (hasObstacleWithMinDurability(board, SURVIVAL_MAX_OBSTACLE_DURABILITY)) {
        return { gameOver: true };
      }
      // (b) 詰み（有効なスワイプなし かつ 起動可能なアイテムなし）
      if (isStuck(board)) return { gameOver: true };
      return { gameOver: false };
    }
  }
}

/** 後方互換: 旧シグネチャ (テスト用) */
export function isGameOver(
  board: (Cell | null)[][],
  mode: GameMode = 'sprint',
  moveCount: number = 0,
  moveLimit?: number,
): boolean {
  return checkGameOverState({
    board,
    mode,
    moveCount,
    moveLimit,
    score: 0,
    rngState: [],
    isGameOver: false,
  }).gameOver;
}
