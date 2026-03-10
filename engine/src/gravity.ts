import { Cell, BOARD_SIZE } from './types.js';

/** 重力落下処理: おじゃまタイルを固定し、セグメントごとに落下させる */
export function applyGravity(board: (Cell | null)[][]): void {
  for (let col = 0; col < BOARD_SIZE; col++) {
    // おじゃまタイルの位置を収集（なければ単一セグメント [0, BOARD_SIZE)）
    const obstacleRows: number[] = [];
    for (let row = 0; row < BOARD_SIZE; row++) {
      if (board[row][col]?.obstacle) obstacleRows.push(row);
    }

    if (obstacleRows.length === 0) {
      // 従来の単純コンパクション
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
    } else {
      // セグメントベースの落下: おじゃまタイルで区切られたセグメントごとにコンパクション
      // セグメント: [segStart, segEnd) — おじゃまタイルの行は含まない
      const segments: [number, number][] = [];
      let segStart = 0;
      for (const obsRow of obstacleRows) {
        if (obsRow > segStart) segments.push([segStart, obsRow]);
        segStart = obsRow + 1;
      }
      if (segStart < BOARD_SIZE) segments.push([segStart, BOARD_SIZE]);

      for (const [start, end] of segments) {
        // セグメント内で下詰め
        let writeRow = end - 1;
        for (let readRow = end - 1; readRow >= start; readRow--) {
          if (board[readRow][col] !== null) {
            if (writeRow !== readRow) {
              board[writeRow][col] = board[readRow][col];
              board[readRow][col] = null;
            }
            writeRow--;
          }
        }
        for (let row = writeRow; row >= start; row--) {
          board[row][col] = null;
        }
      }
    }
  }
}
