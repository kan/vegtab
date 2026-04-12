/**
 * アニメーション用の落下移動計算。
 * gravity 適用前の board から、各タイルの移動元・移動先を計算する。
 * engine.ts の collector と trace.ts の compute*Plan 関数から使用。
 */

import type { Cell } from './types.js';
import { BOARD_SIZE } from './types.js';
import type { DropMove, NewTileEntry } from './traceCollector.js';

function computeDropMovesForSegment(
  board: (Cell | null)[][],
  col: number,
  start: number,
  end: number,
  moves: DropMove[],
  newTileEntries: NewTileEntry[],
): void {
  let writeRow = end - 1;
  let nullCount = 0;
  for (let readRow = end - 1; readRow >= start; readRow--) {
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
      newTileEntries.push({ row: start + i, col, segNulls: nullCount });
    }
  }
}

export function computeDropMoves(board: (Cell | null)[][], passThroughObstacles = false) {
  const moves: DropMove[] = [];
  const newTileEntries: NewTileEntry[] = [];
  for (let col = 0; col < BOARD_SIZE; col++) {
    let hasObstacle = false;
    for (let row = 0; row < BOARD_SIZE; row++) {
      if (board[row][col]?.obstacle) { hasObstacle = true; break; }
    }

    if (!hasObstacle) {
      computeDropMovesForSegment(board, col, 0, BOARD_SIZE, moves, newTileEntries);
    } else if (passThroughObstacles) {
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
    } else {
      const obstacleRows: number[] = [];
      for (let row = 0; row < BOARD_SIZE; row++) {
        if (board[row][col]?.obstacle) obstacleRows.push(row);
      }
      const segments: [number, number][] = [];
      let segStart = 0;
      for (const obsRow of obstacleRows) {
        if (obsRow > segStart) segments.push([segStart, obsRow]);
        segStart = obsRow + 1;
      }
      if (segStart < BOARD_SIZE) segments.push([segStart, BOARD_SIZE]);
      for (const [start, end] of segments) {
        computeDropMovesForSegment(board, col, start, end, moves, newTileEntries);
      }
    }
  }
  return { moves, newTileEntries };
}
