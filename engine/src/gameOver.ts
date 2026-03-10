import { Cell, Direction, GameMode, GameState, Position, BOARD_SIZE } from './types.js';
import { findMatches } from './match.js';
import { cloneBoard } from './board.js';
import { allObstaclesCleared } from './obstacle.js';
import { checkSurvivalQuota } from './survival.js';

/** 有効なスワイプが存在するかチェック */
export function hasValidSwap(board: (Cell | null)[][]): boolean {
  const directions: [number, number][] = [[0, 1], [1, 0]]; // 右と下のみチェック（逆方向は対称）

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = board[row][col];
      if (cell === null || cell.obstacle) continue;

      for (const [dr, dc] of directions) {
        const nr = row + dr;
        const nc = col + dc;
        if (nr >= BOARD_SIZE || nc >= BOARD_SIZE) continue;
        const neighbor = board[nr][nc];
        if (neighbor === null || neighbor.obstacle) continue;

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

/** ゲーム終了判定（3モード対応） */
export function checkGameOverState(state: GameState): { gameOver: boolean; isCleared?: boolean } {
  const { board, mode, moveCount, moveLimit, score, quotaTable } = state;

  switch (mode) {
    case 'sprint': {
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
      if (quotaTable) {
        const segmentScore = score - (state.segmentStartScore ?? 0);
        const check = checkSurvivalQuota(moveCount, segmentScore, quotaTable);
        if (check.isCheckpoint) {
          if (!check.quotaMet) return { gameOver: true };
          // ノルマ達成: 次の区間のためにsegmentStartScoreを更新
          state.segmentStartScore = score;
        }
      }
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
  score?: number,
  quotaTable?: number[],
): boolean {
  return checkGameOverState({
    board,
    mode,
    moveCount,
    moveLimit,
    score: score ?? 0,
    rngState: 0,
    isGameOver: false,
    quotaTable,
  }).gameOver;
}
