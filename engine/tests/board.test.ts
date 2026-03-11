import { describe, it, expect } from 'vitest';
import { generateRawBoard, cloneBoard, createEmptyBoard, fillEmptyCells, createColumnRngStates } from '../src/board.js';
import { createRng } from '../src/rng.js';
import { BOARD_SIZE, NUM_COLORS } from '../src/types.js';

describe('Board', () => {
  it('generateRawBoard が8x8の盤面を生成する', () => {
    const { board } = generateRawBoard(42);
    expect(board.length).toBe(BOARD_SIZE);
    for (const row of board) {
      expect(row.length).toBe(BOARD_SIZE);
    }
  });

  it('全セルが有効な色を持つ', () => {
    const { board } = generateRawBoard(42);
    for (const row of board) {
      for (const cell of row) {
        expect(cell).not.toBeNull();
        expect(cell!.color).toBeGreaterThanOrEqual(0);
        expect(cell!.color).toBeLessThan(NUM_COLORS);
      }
    }
  });

  it('同一シードで同一盤面を生成する', () => {
    const { board: b1 } = generateRawBoard(42);
    const { board: b2 } = generateRawBoard(42);
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(b1[r][c]!.color).toBe(b2[r][c]!.color);
      }
    }
  });

  it('異なるシードで異なる盤面を生成する', () => {
    const { board: b1 } = generateRawBoard(42);
    const { board: b2 } = generateRawBoard(999);
    let same = true;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (b1[r][c]!.color !== b2[r][c]!.color) {
          same = false;
          break;
        }
      }
      if (!same) break;
    }
    expect(same).toBe(false);
  });

  it('cloneBoard はディープコピーを作る', () => {
    const { board } = generateRawBoard(42);
    const clone = cloneBoard(board);
    clone[0][0] = null;
    expect(board[0][0]).not.toBeNull();
  });

  it('fillEmptyCells が全空きマスを埋める', () => {
    const board = createEmptyBoard();
    board[0][0] = null;
    board[3][5] = null;
    fillEmptyCells(board, createColumnRngStates(createRng(42)));
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(board[r][c]).not.toBeNull();
      }
    }
  });
});
