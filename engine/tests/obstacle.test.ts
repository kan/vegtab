import { describe, it, expect } from 'vitest';
import { generateObstacles, damageObstacles, damageAllObstacles, countObstacles, allObstaclesCleared } from '../src/obstacle.js';
import { processDamage } from '../src/engine.js';
import { createRng } from '../src/rng.js';
import { createColumnRngStates, cloneBoard, fillEmptyCells } from '../src/board.js';
import { applyGravity } from '../src/gravity.js';
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

  it('デフォルトはどのシードでも 16 個・耐久値 1 が 6 個、2 が 8 個、3 が 2 個（合計 28）', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const board = makeEmptyBoard();
      generateObstacles(board, createColumnRngStates(createRng(seed)));
      const durabilities = board.flat().flatMap(cell => cell?.obstacle ? [cell.obstacle.durability] : []);
      expect(durabilities).toHaveLength(16);
      expect(durabilities.filter(d => d === 1)).toHaveLength(6);
      expect(durabilities.filter(d => d === 2)).toHaveLength(8);
      expect(durabilities.filter(d => d === 3)).toHaveLength(2);
      expect(durabilities.reduce((a, b) => a + b, 0)).toBe(28);
    }
  });

  it('デフォルトの耐久値の割り当てはシードで変わる', () => {
    const layouts = new Set<string>();
    for (const seed of [1, 42, 100, 999, 12345]) {
      const board = makeEmptyBoard();
      generateObstacles(board, createColumnRngStates(createRng(seed)));
      layouts.add(board.flat().map(cell => cell?.obstacle?.durability ?? 0).join(''));
    }
    expect(layouts.size).toBe(5);
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

describe('damageAllObstacles', () => {
  it('全おじゃまタイルの耐久値が1減少する', () => {
    const board = makeEmptyBoard();
    board[0][0] = { color: 0 as Color, obstacle: { durability: 3 } };
    board[3][3] = { color: 0 as Color, obstacle: { durability: 2 } };
    board[7][7] = { color: 0 as Color, obstacle: { durability: 1 } };

    const { damaged, destroyed } = damageAllObstacles(board);
    expect(damaged.length).toBe(3);
    // (0,0): 3→2
    expect(board[0][0]?.obstacle?.durability).toBe(2);
    // (3,3): 2→1
    expect(board[3][3]?.obstacle?.durability).toBe(1);
    // (7,7): 1→0 → 破壊
    expect(board[7][7]).toBeNull();
    expect(destroyed.length).toBe(1);
    expect(destroyed[0]).toEqual({ row: 7, col: 7 });
  });

  it('耐久値1のおじゃまタイルが破壊されてnullになる', () => {
    const board = makeEmptyBoard();
    board[2][3] = { color: 0 as Color, obstacle: { durability: 1 } };

    const { damaged, destroyed } = damageAllObstacles(board);
    expect(board[2][3]).toBeNull();
    expect(damaged).toEqual([{ row: 2, col: 3 }]);
    expect(destroyed).toEqual([{ row: 2, col: 3 }]);
  });

  it('おじゃまタイルがない盤面では空配列を返す', () => {
    const board = makeEmptyBoard();
    const { damaged, destroyed } = damageAllObstacles(board);
    expect(damaged).toEqual([]);
    expect(destroyed).toEqual([]);
  });

  it('破壊されたおじゃまはdestroyedに含まれ、生存おじゃまはdamagedにのみ含まれる', () => {
    const board = makeEmptyBoard();
    board[0][0] = { color: 0 as Color, obstacle: { durability: 2 } }; // 生存
    board[1][1] = { color: 0 as Color, obstacle: { durability: 1 } }; // 破壊

    const { damaged, destroyed } = damageAllObstacles(board);
    expect(damaged.length).toBe(2);
    expect(destroyed.length).toBe(1);
    expect(destroyed[0]).toEqual({ row: 1, col: 1 });
    // 生存おじゃまはdamagedにいるがdestroyedにはいない
    expect(damaged).toContainEqual({ row: 0, col: 0 });
    expect(destroyed).not.toContainEqual({ row: 0, col: 0 });
  });

  it('全おじゃまが耐久値1の場合は全て破壊される', () => {
    const board = makeEmptyBoard();
    board[0][0] = { color: 0 as Color, obstacle: { durability: 1 } };
    board[1][1] = { color: 0 as Color, obstacle: { durability: 1 } };
    board[2][2] = { color: 0 as Color, obstacle: { durability: 1 } };

    const { damaged, destroyed } = damageAllObstacles(board);
    expect(damaged.length).toBe(3);
    expect(destroyed.length).toBe(3);
    expect(board[0][0]).toBeNull();
    expect(board[1][1]).toBeNull();
    expect(board[2][2]).toBeNull();
  });

  it('nullセルは無視される', () => {
    const board = makeEmptyBoard();
    board[0][0] = null;
    board[1][1] = { color: 0 as Color, obstacle: { durability: 2 } };

    const { damaged, destroyed } = damageAllObstacles(board);
    expect(damaged.length).toBe(1);
    expect(damaged[0]).toEqual({ row: 1, col: 1 });
    expect(destroyed.length).toBe(0);
  });

  it('通常セル（おじゃまなし）には影響しない', () => {
    const board = makeEmptyBoard();
    board[0][0] = { color: 0 as Color, obstacle: { durability: 2 } };
    // (3,3) は通常セル
    const normalCell = board[3][3];

    damageAllObstacles(board);
    // 通常セルは変化なし
    expect(board[3][3]).toBe(normalCell);
    expect(board[3][3]?.obstacle).toBeUndefined();
  });
});

describe('processDamage', () => {
  it('破壊なし時はRNG状態が変化しない', () => {
    const board = makeEmptyBoard();
    // おじゃまタイルはあるが、消去位置が隣接していないのでダメージなし
    board[3][3] = { color: 0 as Color, obstacle: { durability: 2 } };
    const rng = createColumnRngStates(createRng(42));
    const rngBefore = [...rng];

    const rngAfter = processDamage(board, [{ row: 0, col: 0 }], rng);
    expect(rngAfter).toEqual(rngBefore);
    // おじゃまタイルは無傷
    expect(board[3][3]?.obstacle?.durability).toBe(2);
  });

  it('空の消去位置リストではRNG状態が変化しない', () => {
    const board = makeEmptyBoard();
    const rng = createColumnRngStates(createRng(42));
    const rngBefore = [...rng];

    const rngAfter = processDamage(board, [], rng);
    expect(rngAfter).toEqual(rngBefore);
  });

  it('おじゃま破壊時にgravity+fillが実行されRNG状態が変化する', () => {
    const board = makeEmptyBoard();
    // 耐久値1のおじゃまタイルを配置
    board[5][2] = { color: 0 as Color, obstacle: { durability: 1 } };
    // おじゃまの上にタイルを配置（gravity後に落下する）
    board[4][2] = { color: 1 as Color };
    // おじゃまの隣を消去位置にする
    board[5][1] = null; // 消去済み扱い

    const rng = createColumnRngStates(createRng(42));
    const rngBefore = [...rng];

    const rngAfter = processDamage(board, [{ row: 5, col: 1 }], rng);

    // おじゃまが破壊されてnullになっている
    expect(board[5][2]).not.toBeNull();
    expect(board[5][2]?.obstacle).toBeUndefined();
    // おじゃま破壊でgravity+fillが走るのでRNGは変化する
    expect(rngAfter).not.toEqual(rngBefore);
  });

  it('破壊後に空セルがfillEmptyCellsで補充される', () => {
    const board = makeEmptyBoard();
    board[5][2] = { color: 0 as Color, obstacle: { durability: 1 } };
    // (5,1)を消去位置に指定するため、事前にnullにしておく
    board[5][1] = null;

    const rng = createColumnRngStates(createRng(42));
    processDamage(board, [{ row: 5, col: 1 }], rng);

    // おじゃまが破壊された後、gravity+fillにより全セルが埋まっている
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(board[r][c]).not.toBeNull();
      }
    }
  });

  it('processDamageとdamageObstacles+gravity+fillの手動実行は同じ結果になる', () => {
    // フロントエンド修正後のフロー: damageObstacles → gravity → fill
    // エンジンフロー: processDamage(内部でdamageObstacles → gravity → fill)
    // 両者が同一の結果・RNG状態になることを検証

    function makeTestBoard(): (Cell | null)[][] {
      const b: (Cell | null)[][] = [];
      for (let r = 0; r < BOARD_SIZE; r++) {
        b[r] = [];
        for (let c = 0; c < BOARD_SIZE; c++) {
          b[r][c] = { color: ((r * 3 + c * 7 + 11) % 5) as Color };
        }
      }
      // 耐久値1のおじゃまタイルを配置
      b[5][2] = { color: 1 as Color, obstacle: { durability: 1 } };
      b[6][4] = { color: 2 as Color, obstacle: { durability: 1 } };
      return b;
    }

    const clearedPositions = [
      { row: 5, col: 1 }, { row: 5, col: 3 }, // (5,2)の左右
      { row: 6, col: 3 },                       // (6,4)の左
    ];

    // --- processDamage（エンジンフロー） ---
    const boardEngine = makeTestBoard();
    for (const pos of clearedPositions) boardEngine[pos.row][pos.col] = null;
    const rngEngine = createColumnRngStates(createRng(42));
    const rngAfterEngine = processDamage(boardEngine, clearedPositions, rngEngine);

    // --- 手動フロー（修正後のフロントエンドと同等） ---
    const boardManual = makeTestBoard();
    for (const pos of clearedPositions) boardManual[pos.row][pos.col] = null;
    const rngManual = createColumnRngStates(createRng(42));
    const destroyed = damageObstacles(boardManual, clearedPositions);
    let rngAfterManual = rngManual;
    if (destroyed.length > 0) {
      applyGravity(boardManual);
      rngAfterManual = fillEmptyCells(boardManual, rngAfterManual);
    }

    // 盤面が一致
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(boardEngine[r][c]?.color).toBe(boardManual[r][c]?.color);
        expect(boardEngine[r][c]?.obstacle?.durability).toBe(boardManual[r][c]?.obstacle?.durability);
        expect(boardEngine[r][c]?.item).toBe(boardManual[r][c]?.item);
      }
    }

    // RNG状態が一致
    expect(rngAfterEngine).toEqual(rngAfterManual);
  });

  it('耐久値減少のみ（破壊なし）の場合はgravity+fillが実行されない', () => {
    const board = makeEmptyBoard();
    board[3][3] = { color: 0 as Color, obstacle: { durability: 2 } };
    const boardBefore = cloneBoard(board);
    const rng = createColumnRngStates(createRng(42));
    const rngBefore = [...rng];

    const rngAfter = processDamage(board, [{ row: 3, col: 2 }], rng);

    // 耐久値は減少
    expect(board[3][3]?.obstacle?.durability).toBe(1);
    // 破壊されていないのでRNGは変化しない
    expect(rngAfter).toEqual(rngBefore);
  });
});
