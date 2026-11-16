import { Cell, BOARD_SIZE } from './types.js';
import { isPinned } from './lock.js';

/** 重力落下処理。おじゃまタイルと鎖の付いた野菜は固定したまま、それ以外のタイルがすり抜けて下に詰まる */
export function applyGravity(board: (Cell | null)[][]): void {
  for (let col = 0; col < BOARD_SIZE; col++) {
    let hasPinned = false;
    for (let row = 0; row < BOARD_SIZE; row++) {
      if (isPinned(board[row][col])) { hasPinned = true; break; }
    }
    if (!hasPinned) {
      // 固定のマスなし: 配列を作らずにその場で下詰め（落下のホットパス）
      compactColumn(board, col);
      continue;
    }
    // 固定のマスを除外した空きスロットに、ほかのタイルを下から詰める
    const freeRows: number[] = []; // 下から順
    const tiles: (Cell | null)[] = [];
    for (let row = BOARD_SIZE - 1; row >= 0; row--) {
      if (isPinned(board[row][col])) continue;
      freeRows.push(row);
      if (board[row][col] !== null) tiles.push(board[row][col]);
    }
    for (let i = 0; i < freeRows.length; i++) {
      board[freeRows[i]][col] = i < tiles.length ? tiles[i] : null;
    }
  }
}

/** おじゃまのない列を下詰め */
function compactColumn(board: (Cell | null)[][], col: number): void {
  let writeRow = BOARD_SIZE - 1;
  for (let readRow = BOARD_SIZE - 1; readRow >= 0; readRow--) {
    if (board[readRow][col] !== null) {
      if (writeRow !== readRow) {
        board[writeRow][col] = board[readRow][col];
        board[readRow][col] = null;
      }
      writeRow--;
    }
  }
  for (let row = writeRow; row >= 0; row--) {
    board[row][col] = null;
  }
}
