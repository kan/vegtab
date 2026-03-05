import { describe, it, expect } from 'vitest';
import { applyGravity } from '../src/gravity.js';
import { Cell, Color, BOARD_SIZE } from '../src/types.js';

describe('Gravity', () => {
  it('空きマスの上のセルが下に落下する', () => {
    const board: (Cell | null)[][] = Array.from({ length: BOARD_SIZE }, () =>
      Array.from({ length: BOARD_SIZE }, () => null)
    );
    board[0][0] = { color: 1 as Color };
    board[2][0] = { color: 2 as Color };
    // 1と2は間に空きがある

    applyGravity(board);

    // 下から詰まる
    expect(board[BOARD_SIZE - 1][0]!.color).toBe(2);
    expect(board[BOARD_SIZE - 2][0]!.color).toBe(1);
    // 他はnull
    for (let r = 0; r < BOARD_SIZE - 2; r++) {
      expect(board[r][0]).toBeNull();
    }
  });

  it('既に詰まっている列は変化しない', () => {
    const board: (Cell | null)[][] = Array.from({ length: BOARD_SIZE }, (_, r) =>
      Array.from({ length: BOARD_SIZE }, (_, c) => ({ color: ((r + c) % 5) as Color }))
    );
    const before = JSON.stringify(board);
    applyGravity(board);
    expect(JSON.stringify(board)).toBe(before);
  });

  it('複数列が独立に処理される', () => {
    const board: (Cell | null)[][] = Array.from({ length: BOARD_SIZE }, () =>
      Array.from({ length: BOARD_SIZE }, () => null)
    );
    board[0][0] = { color: 1 as Color };
    board[0][1] = { color: 2 as Color };

    applyGravity(board);

    expect(board[BOARD_SIZE - 1][0]!.color).toBe(1);
    expect(board[BOARD_SIZE - 1][1]!.color).toBe(2);
  });
});
