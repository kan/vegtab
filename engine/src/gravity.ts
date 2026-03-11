import { Cell, BOARD_SIZE } from './types.js';

/** 重力落下処理
 * @param passThroughObstacles true(Clearモード)ならタイルがおじゃまタイルをすり抜けて落下する
 */
export function applyGravity(board: (Cell | null)[][], passThroughObstacles = false): void {
  for (let col = 0; col < BOARD_SIZE; col++) {
    // おじゃまタイルの位置を収集
    const obstacleRows: number[] = [];
    for (let row = 0; row < BOARD_SIZE; row++) {
      if (board[row][col]?.obstacle) obstacleRows.push(row);
    }

    if (obstacleRows.length === 0) {
      // おじゃまなし: 単純コンパクション
      compactColumn(board, col, 0, BOARD_SIZE);
    } else if (passThroughObstacles) {
      // Clearモード: おじゃまタイルを固定したまま、それ以外のタイルを下詰め
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
    } else {
      // セグメントベースの落下: おじゃまタイルで区切られたセグメントごとにコンパクション
      const segments: [number, number][] = [];
      let segStart = 0;
      for (const obsRow of obstacleRows) {
        if (obsRow > segStart) segments.push([segStart, obsRow]);
        segStart = obsRow + 1;
      }
      if (segStart < BOARD_SIZE) segments.push([segStart, BOARD_SIZE]);

      for (const [start, end] of segments) {
        compactColumn(board, col, start, end);
      }
    }
  }
}

/** セグメント [start, end) 内で下詰め */
function compactColumn(board: (Cell | null)[][], col: number, start: number, end: number): void {
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
