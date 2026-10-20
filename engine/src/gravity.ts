import { Cell, BOARD_SIZE } from './types.js';

/** 重力落下処理。おじゃまタイルは固定したまま、それ以外のタイルがすり抜けて下に詰まる */
export function applyGravity(board: (Cell | null)[][]): void {
  for (let col = 0; col < BOARD_SIZE; col++) {
    let hasObstacle = false;
    for (let row = 0; row < BOARD_SIZE; row++) {
      if (board[row][col]?.obstacle) { hasObstacle = true; break; }
    }
    if (!hasObstacle) {
      // おじゃまなし: 配列を作らずにその場で下詰め（落下のホットパス）
      compactColumn(board, col);
      continue;
    }
    // おじゃま位置を除外した空きスロットに、非おじゃまタイルを下から詰める
    const freeRows: number[] = []; // 下から順
    const tiles: (Cell | null)[] = [];
    for (let row = BOARD_SIZE - 1; row >= 0; row--) {
      if (board[row][col]?.obstacle) continue;
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
