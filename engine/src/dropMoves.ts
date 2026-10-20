/**
 * アニメーション用の落下移動計算。
 * gravity 適用前の board から、各タイルの移動元・移動先を計算する。
 * engine.ts の collector と trace.ts の compute*Plan 関数から使用。
 */

import type { Cell } from './types.js';
import { BOARD_SIZE } from './types.js';
import type { DropMove, NewTileEntry } from './traceCollector.js';

/**
 * おじゃまタイルのない列の落下移動。下のすり抜け用の計算でも moves は同じになるが、
 * newTileEntries の並び（こちらは上の行から）が変わり、アニメーション計画の内容が変わるので分けている
 */
function computeDropMovesForPlainColumn(
  board: (Cell | null)[][],
  col: number,
  moves: DropMove[],
  newTileEntries: NewTileEntry[],
): void {
  let writeRow = BOARD_SIZE - 1;
  let nullCount = 0;
  for (let readRow = BOARD_SIZE - 1; readRow >= 0; readRow--) {
    if (board[readRow][col] !== null) {
      if (writeRow !== readRow) {
        moves.push({ col, fromRow: readRow, toRow: writeRow });
      }
      writeRow--;
    } else {
      nullCount++;
    }
  }
  if (nullCount > 0) {
    for (let i = 0; i < nullCount; i++) {
      newTileEntries.push({ row: i, col, segNulls: nullCount });
    }
  }
}

/** applyGravity と同じく、おじゃまタイルを固定して他のタイルがすり抜けて落ちる前提で計算する */
export function computeDropMoves(board: (Cell | null)[][]) {
  const moves: DropMove[] = [];
  const newTileEntries: NewTileEntry[] = [];
  for (let col = 0; col < BOARD_SIZE; col++) {
    let hasObstacle = false;
    for (let row = 0; row < BOARD_SIZE; row++) {
      if (board[row][col]?.obstacle) { hasObstacle = true; break; }
    }

    if (!hasObstacle) {
      computeDropMovesForPlainColumn(board, col, moves, newTileEntries);
    } else {
      const freeRows: number[] = [];
      const tiles: { row: number; cell: Cell }[] = [];
      for (let row = BOARD_SIZE - 1; row >= 0; row--) {
        if (board[row][col]?.obstacle) continue;
        freeRows.push(row);
        if (board[row][col] !== null) {
          tiles.push({ row, cell: board[row][col]! });
        }
      }
      let nullCount = 0;
      for (let i = 0; i < freeRows.length; i++) {
        if (i < tiles.length) {
          if (freeRows[i] !== tiles[i].row) {
            moves.push({ col, fromRow: tiles[i].row, toRow: freeRows[i] });
          }
        } else {
          nullCount++;
        }
      }
      if (nullCount > 0) {
        const topFreeRows = freeRows.slice(freeRows.length - nullCount);
        for (const row of topFreeRows) {
          newTileEntries.push({ row, col, segNulls: nullCount });
        }
      }
    }
  }
  return { moves, newTileEntries };
}
