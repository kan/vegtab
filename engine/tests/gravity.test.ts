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

  it('おじゃまタイルは固定されて落下しない', () => {
    const board: (Cell | null)[][] = Array.from({ length: BOARD_SIZE }, () =>
      Array.from({ length: BOARD_SIZE }, () => null)
    );
    board[3][0] = { color: 0 as Color, obstacle: { durability: 2 } };

    applyGravity(board);

    // おじゃまタイルは元の位置に留まる
    expect(board[3][0]?.obstacle?.durability).toBe(2);
    // 下に落下していない
    expect(board[BOARD_SIZE - 1][0]).toBeNull();
  });

  it('おじゃまタイルの上のタイルはおじゃまタイルを貫通しない', () => {
    const board: (Cell | null)[][] = Array.from({ length: BOARD_SIZE }, () =>
      Array.from({ length: BOARD_SIZE }, () => null)
    );
    // row 1 に通常タイル、row 4 におじゃまタイル
    board[1][0] = { color: 1 as Color };
    board[4][0] = { color: 0 as Color, obstacle: { durability: 1 } };

    applyGravity(board);

    // おじゃまタイルは row 4 に固定
    expect(board[4][0]?.obstacle?.durability).toBe(1);
    // 通常タイルはおじゃまタイルの直上 (row 3) まで落下
    expect(board[3][0]?.color).toBe(1);
    expect(board[3][0]?.obstacle).toBeUndefined();
  });

  it('おじゃまタイルによるセグメント分割で各セグメント内が独立にコンパクションされる', () => {
    const board: (Cell | null)[][] = Array.from({ length: BOARD_SIZE }, () =>
      Array.from({ length: BOARD_SIZE }, () => null)
    );
    // row 3 におじゃまタイル (セグメント: [0,3) と [4,8))
    board[3][0] = { color: 0 as Color, obstacle: { durability: 1 } };
    // 上セグメント: row 0 にタイル
    board[0][0] = { color: 1 as Color };
    // 下セグメント: row 5 にタイル
    board[5][0] = { color: 2 as Color };

    applyGravity(board);

    // おじゃまタイルは固定
    expect(board[3][0]?.obstacle).toBeDefined();
    // 上セグメント: row 0 のタイルは row 2 (おじゃまタイルの直上) に落下
    expect(board[2][0]?.color).toBe(1);
    // 下セグメント: row 5 のタイルは row 7 (最下段) に落下
    expect(board[BOARD_SIZE - 1][0]?.color).toBe(2);
  });

  it('同一列に複数おじゃまタイルがある場合、各セグメントが独立にコンパクションされる', () => {
    const board: (Cell | null)[][] = Array.from({ length: BOARD_SIZE }, () =>
      Array.from({ length: BOARD_SIZE }, () => null)
    );
    // row 2 と row 5 におじゃまタイル → セグメント: [0,2), [3,5), [6,8)
    board[2][0] = { color: 0 as Color, obstacle: { durability: 1 } };
    board[5][0] = { color: 0 as Color, obstacle: { durability: 2 } };
    // 各セグメントにタイル配置
    board[0][0] = { color: 1 as Color }; // セグメント [0,2)
    board[3][0] = { color: 2 as Color }; // セグメント [3,5)
    board[6][0] = { color: 3 as Color }; // セグメント [6,8)

    applyGravity(board);

    // おじゃまタイルは固定
    expect(board[2][0]?.obstacle).toBeDefined();
    expect(board[5][0]?.obstacle).toBeDefined();
    // セグメント [0,2): row 0 のタイルは row 1 に落下
    expect(board[1][0]?.color).toBe(1);
    // セグメント [3,5): row 3 のタイルは row 4 に落下
    expect(board[4][0]?.color).toBe(2);
    // セグメント [6,8): row 6 のタイルは row 7 に落下
    expect(board[7][0]?.color).toBe(3);
  });

  it('おじゃまタイルが除去された位置は通常のnullとなり上のタイルが落下する', () => {
    const board: (Cell | null)[][] = Array.from({ length: BOARD_SIZE }, () =>
      Array.from({ length: BOARD_SIZE }, () => null)
    );
    // row 0 に通常タイル、row 3 におじゃまタイルがあったが除去された状態をシミュレート
    board[0][0] = { color: 1 as Color };
    board[1][0] = { color: 2 as Color };
    // row 3 のおじゃまタイルを除去（null にする）→ おじゃまタイルなしの列になる
    // この場合は通常の下詰めが適用される

    applyGravity(board);

    // 通常の下詰め: 2つのタイルが最下段に
    expect(board[BOARD_SIZE - 1][0]?.color).toBe(2);
    expect(board[BOARD_SIZE - 2][0]?.color).toBe(1);
  });
});

describe('Gravity (passThroughObstacles = true / Clear mode)', () => {
  it('タイルがおじゃまタイルをすり抜けて最下段まで落下する', () => {
    const board: (Cell | null)[][] = Array.from({ length: BOARD_SIZE }, () =>
      Array.from({ length: BOARD_SIZE }, () => null)
    );
    board[1][0] = { color: 1 as Color };
    board[4][0] = { color: 0 as Color, obstacle: { durability: 1 } };

    applyGravity(board, true);

    expect(board[4][0]?.obstacle?.durability).toBe(1);
    expect(board[BOARD_SIZE - 1][0]?.color).toBe(1);
  });

  it('複数おじゃまタイルをすり抜けて落下する', () => {
    const board: (Cell | null)[][] = Array.from({ length: BOARD_SIZE }, () =>
      Array.from({ length: BOARD_SIZE }, () => null)
    );
    board[0][0] = { color: 1 as Color };
    board[2][0] = { color: 0 as Color, obstacle: { durability: 1 } };
    board[5][0] = { color: 0 as Color, obstacle: { durability: 2 } };

    applyGravity(board, true);

    expect(board[2][0]?.obstacle).toBeDefined();
    expect(board[5][0]?.obstacle).toBeDefined();
    expect(board[BOARD_SIZE - 1][0]?.color).toBe(1);
    expect(board[0][0]).toBeNull();
  });

  it('おじゃまタイルの間にあるタイルも下に詰まる', () => {
    const board: (Cell | null)[][] = Array.from({ length: BOARD_SIZE }, () =>
      Array.from({ length: BOARD_SIZE }, () => null)
    );
    board[2][0] = { color: 0 as Color, obstacle: { durability: 1 } };
    board[3][0] = { color: 1 as Color };
    board[5][0] = { color: 0 as Color, obstacle: { durability: 2 } };

    applyGravity(board, true);

    expect(board[2][0]?.obstacle).toBeDefined();
    expect(board[5][0]?.obstacle).toBeDefined();
    expect(board[BOARD_SIZE - 1][0]?.color).toBe(1);
  });

  it('おじゃまなしの列はpassThroughでも通常と同じ結果', () => {
    const board: (Cell | null)[][] = Array.from({ length: BOARD_SIZE }, () =>
      Array.from({ length: BOARD_SIZE }, () => null)
    );
    board[0][0] = { color: 1 as Color };
    board[2][0] = { color: 2 as Color };

    applyGravity(board, true);

    expect(board[BOARD_SIZE - 1][0]!.color).toBe(2);
    expect(board[BOARD_SIZE - 2][0]!.color).toBe(1);
  });

  it('おじゃまタイルが最下段にある場合、通常タイルはその上に詰まる', () => {
    const board: (Cell | null)[][] = Array.from({ length: BOARD_SIZE }, () =>
      Array.from({ length: BOARD_SIZE }, () => null)
    );
    board[0][0] = { color: 1 as Color };
    board[1][0] = { color: 2 as Color };
    board[BOARD_SIZE - 1][0] = { color: 0 as Color, obstacle: { durability: 1 } };

    applyGravity(board, true);

    expect(board[BOARD_SIZE - 1][0]?.obstacle).toBeDefined();
    expect(board[BOARD_SIZE - 2][0]?.color).toBe(2);
    expect(board[BOARD_SIZE - 3][0]?.color).toBe(1);
  });
});
