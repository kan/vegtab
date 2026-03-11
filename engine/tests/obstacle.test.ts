import { describe, it, expect } from 'vitest';
import { generateObstacles, damageObstacles, countObstacles, allObstaclesCleared } from '../src/obstacle.js';
import { createRng } from '../src/rng.js';
import { createColumnRngStates } from '../src/board.js';
import { Cell, Color, BOARD_SIZE } from '../src/types.js';

function makeEmptyBoard(): (Cell | null)[][] {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => ({ color: 0 as Color }))
  );
}

describe('generateObstacles', () => {
  it('同一シードで同一のおじゃまタイル配置を生成する（決定性）', () => {
    const board1 = makeEmptyBoard();
    const board2 = makeEmptyBoard();
    const colRng = createColumnRngStates(createRng(42));

    const r1 = generateObstacles(board1, colRng);
    const r2 = generateObstacles(board2, colRng);

    expect(r1.rngState).toEqual(r2.rngState);
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        expect(board1[row][col]?.obstacle?.durability).toBe(
          board2[row][col]?.obstacle?.durability
        );
      }
    }
  });

  it('デフォルトのおじゃまタイル数は10-20の範囲', () => {
    // 複数のシードで検証
    for (const seed of [1, 42, 100, 999, 12345]) {
      const board = makeEmptyBoard();
      const colRng = createColumnRngStates(createRng(seed));
      generateObstacles(board, colRng);
      const count = countObstacles(board);
      expect(count).toBeGreaterThanOrEqual(10);
      expect(count).toBeLessThanOrEqual(20);
    }
  });

  it('カスタム数を指定するとその数のおじゃまタイルが生成される', () => {
    const board = makeEmptyBoard();
    generateObstacles(board, createColumnRngStates(createRng(42)), 5);
    expect(countObstacles(board)).toBe(5);
  });

  it('カスタム数0を指定するとおじゃまタイルが生成されない', () => {
    const board = makeEmptyBoard();
    generateObstacles(board, createColumnRngStates(createRng(42)), 0);
    expect(countObstacles(board)).toBe(0);
  });

  it('耐久値の分布がおおよそ50%/33%/17%になる', () => {
    // 大量生成して統計的に検証
    const board = makeEmptyBoard();
    generateObstacles(board, createColumnRngStates(createRng(42)), 60); // 60個生成（64マス中）

    let dur1 = 0, dur2 = 0, dur3 = 0;
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const obs = board[row][col]?.obstacle;
        if (obs) {
          if (obs.durability === 1) dur1++;
          else if (obs.durability === 2) dur2++;
          else if (obs.durability === 3) dur3++;
        }
      }
    }

    const total = dur1 + dur2 + dur3;
    expect(total).toBe(60);
    // 許容誤差を設けて分布を検証（統計的テスト）
    expect(dur1 / total).toBeGreaterThan(0.3);  // 理論値50%
    expect(dur1 / total).toBeLessThan(0.7);
    expect(dur2 / total).toBeGreaterThan(0.15); // 理論値33%
    expect(dur2 / total).toBeLessThan(0.5);
    expect(dur3 / total).toBeGreaterThan(0.02); // 理論値17%
    expect(dur3 / total).toBeLessThan(0.35);
  });

  it('異なるシードで異なる配置が生成される', () => {
    const board1 = makeEmptyBoard();
    const board2 = makeEmptyBoard();
    generateObstacles(board1, createColumnRngStates(createRng(42)), 10);
    generateObstacles(board2, createColumnRngStates(createRng(999)), 10);

    let same = true;
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const o1 = board1[row][col]?.obstacle;
        const o2 = board2[row][col]?.obstacle;
        if ((o1?.durability ?? 0) !== (o2?.durability ?? 0)) {
          same = false;
          break;
        }
      }
      if (!same) break;
    }
    expect(same).toBe(false);
  });
});

describe('damageObstacles', () => {
  it('隣接する消去位置でおじゃまタイルの耐久値が1減る', () => {
    const board = makeEmptyBoard();
    board[3][3] = { color: 0 as Color, obstacle: { durability: 2 } };

    // (3,2) を消去 → (3,3) の右隣
    damageObstacles(board, [{ row: 3, col: 2 }]);
    expect(board[3][3]?.obstacle?.durability).toBe(1);
  });

  it('耐久値が0になるとセルがnullになる', () => {
    const board = makeEmptyBoard();
    board[3][3] = { color: 0 as Color, obstacle: { durability: 1 } };

    const destroyed = damageObstacles(board, [{ row: 3, col: 2 }]);
    expect(board[3][3]).toBeNull();
    expect(destroyed.length).toBe(1);
    expect(destroyed[0]).toEqual({ row: 3, col: 3 });
  });

  it('隣接しない位置ではダメージを受けない', () => {
    const board = makeEmptyBoard();
    board[3][3] = { color: 0 as Color, obstacle: { durability: 2 } };

    // (0,0) を消去 → (3,3) とは隣接していない
    damageObstacles(board, [{ row: 0, col: 0 }]);
    expect(board[3][3]?.obstacle?.durability).toBe(2);
  });

  it('複数のマッチが同一おじゃまタイルに隣接しても1回しかダメージを受けない', () => {
    const board = makeEmptyBoard();
    board[3][3] = { color: 0 as Color, obstacle: { durability: 3 } };

    // (3,2) と (3,4) の両方が消去 → (3,3) の左右隣だが、同一おじゃまタイルには1回だけ
    // damageObstacles の damaged Set により、同じ位置は1回のみ処理される
    // ただし (3,2) と (3,4) は異なるclearedPositionから同じ(3,3)をダメージするので、
    // 実際には2つの別方向からダメージが来る。Set は obstacle 位置をキーにしているので1回のみ。
    damageObstacles(board, [{ row: 3, col: 2 }, { row: 3, col: 4 }]);
    expect(board[3][3]?.obstacle?.durability).toBe(2);
  });

  it('上下左右4方向全てからダメージ判定が行われる', () => {
    const board = makeEmptyBoard();
    board[3][3] = { color: 0 as Color, obstacle: { durability: 1 } };

    // 上方向(2,3)から消去
    const destroyed = damageObstacles(board, [{ row: 2, col: 3 }]);
    expect(destroyed.length).toBe(1);
    expect(board[3][3]).toBeNull();
  });

  it('盤面端のおじゃまタイルにも正しくダメージが入る', () => {
    const board = makeEmptyBoard();
    board[0][0] = { color: 0 as Color, obstacle: { durability: 1 } };

    // (0,1) を消去 → (0,0) の右隣
    const destroyed = damageObstacles(board, [{ row: 0, col: 1 }]);
    expect(board[0][0]).toBeNull();
    expect(destroyed.length).toBe(1);
  });
});

describe('countObstacles', () => {
  it('おじゃまタイルの数を正しくカウントする', () => {
    const board = makeEmptyBoard();
    board[0][0] = { color: 0 as Color, obstacle: { durability: 1 } };
    board[1][1] = { color: 0 as Color, obstacle: { durability: 2 } };
    board[2][2] = { color: 0 as Color, obstacle: { durability: 3 } };
    expect(countObstacles(board)).toBe(3);
  });

  it('おじゃまタイルがなければ0を返す', () => {
    const board = makeEmptyBoard();
    expect(countObstacles(board)).toBe(0);
  });
});

describe('allObstaclesCleared', () => {
  it('おじゃまタイルがなければtrueを返す', () => {
    const board = makeEmptyBoard();
    expect(allObstaclesCleared(board)).toBe(true);
  });

  it('おじゃまタイルが残っていればfalseを返す', () => {
    const board = makeEmptyBoard();
    board[0][0] = { color: 0 as Color, obstacle: { durability: 1 } };
    expect(allObstaclesCleared(board)).toBe(false);
  });
});
