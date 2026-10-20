import { Cell, GameState, BOARD_SIZE } from './types.js';
import { findMatches, hasMatches, hasMatchAt } from './match.js';
import { cloneBoard } from './board.js';
import { allObstaclesCleared } from './obstacle.js';

/**
 * (r1, c1) と (r2, c2) を入れ替えるとマッチが成立するか。processAction がスワイプを受け付ける条件
 * （入れ替えた盤面に findMatches で何か見つかる）と同じ結果を返す。
 * - 盤面にマッチが無い（安定している）とき: 新しくできるマッチは入れ替えた 2 マスのどちらかを含むので、
 *   入れ替えた後の盤面として読み替えながら、2 マスの周りだけを調べる（盤面は書き換えない）
 * - マッチが残っているとき（連鎖の安全弁で打ち切った盤面など）: 入れ替えに関係なく残ったマッチで受け付けられる
 *   ことがあるので、processAction と同じく盤面を複製して全体を調べる
 */
function swapMakesMatch(
  board: (Cell | null)[][], isStable: () => boolean, r1: number, c1: number, r2: number, c2: number,
): boolean {
  if (!isStable()) {
    const testBoard = cloneBoard(board);
    testBoard[r1][c1] = { ...board[r2][c2]! };
    testBoard[r2][c2] = { ...board[r1][c1]! };
    return findMatches(testBoard).length > 0;
  }
  const swapped = (r: number, c: number): Cell | null => {
    if (r === r1 && c === c1) return board[r2][c2];
    if (r === r2 && c === c2) return board[r1][c1];
    return board[r][c];
  };
  return hasMatchAt(r1, c1, swapped) || hasMatchAt(r2, c2, swapped);
}

/** 有効なスワイプが存在するかチェック */
export function hasValidSwap(board: (Cell | null)[][]): boolean {
  const directions: [number, number][] = [[0, 1], [1, 0]]; // 右と下のみチェック（逆方向は対称）
  // 盤面全体のマッチの有無は、入れ替えを調べる必要が出たときに 1 回だけ求める（アイテムの手で先に決まることが多い）
  let stable: boolean | undefined;
  const isStable = () => (stable ??= !hasMatches(board));

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
          if (!nonObstacle.item && swapMakesMatch(board, isStable, row, col, nr, nc)) return true;
          continue;
        }

        // アイテム同士のスワイプは常に有効（合成）
        if (cell.item && neighbor.item) return true;

        // アイテムとの入れ替えは有効
        if (cell.item || neighbor.item) return true;

        // 通常のタイル同士: 入れ替えてマッチが成立するか
        if (swapMakesMatch(board, isStable, row, col, nr, nc)) return true;
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
