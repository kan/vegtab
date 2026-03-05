import { Cell, BOARD_SIZE } from './types.js';

/** 重力落下処理: nullセルに上のセルを落下させる */
export function applyGravity(board: (Cell | null)[][]): void {
  for (let col = 0; col < BOARD_SIZE; col++) {
    // 下から上に走査し、空きマスを埋める
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
    // writeRow以上は全てnull（上部の空きスペース）
    for (let row = writeRow; row >= 0; row--) {
      board[row][col] = null;
    }
  }
}
