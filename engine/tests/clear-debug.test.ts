/**
 * Debug investigation for CLEAR mode bugs reported with 2026-04-05 seed.
 *
 * Findings summary:
 * 1. ENGINE is correct — obstacle damage, item generation, gravity all work properly.
 * 2. FRONTEND chain animation diverges from engine because it uses damageObstacles()
 *    directly instead of processDamage(), missing the gravity+fill that processDamage
 *    performs when obstacles are destroyed.
 * 3. The "item before damage" change (df9570b) interacts with processDamage's internal
 *    gravity: items placed at cleared positions above destroyed obstacles will fall
 *    during processDamage's gravity. This is correct for the engine, but the frontend
 *    doesn't replicate this behavior in its animation chain computation.
 */
import { describe, it, expect } from 'vitest';
import { initializeGame, processAction, processDamage } from '../src/engine.js';
import { generateDailySeed } from '../src/seed.js';
import { BOARD_SIZE, Cell, Action, Position, Color, NUM_COLORS } from '../src/types.js';
import { countObstacles, damageObstacles } from '../src/obstacle.js';
import { applyGravity } from '../src/gravity.js';
import { fillEmptyCells } from '../src/board.js';

const colorNames = ['R', 'G', 'B', 'Y', 'P'];
const itemShort: Record<string, string> = { scope: 'Sp', v_cut: 'Vc', h_cut: 'Hc', burst: 'Bu', flush: 'Fl' };

function posLabel(row: number, col: number): string {
  return `${String.fromCharCode(97 + col)}${8 - row}`;
}

function printBoard(board: (Cell | null)[][], label = '') {
  if (label) console.log(label);
  console.log('     a    b    c    d    e    f    g    h');
  for (let row = 0; row < BOARD_SIZE; row++) {
    const cells: string[] = [];
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = board[row][col];
      if (!cell) cells.push(' ... ');
      else if (cell.obstacle) cells.push(`OB${cell.obstacle.durability}${colorNames[cell.color]}`);
      else if (cell.item) cells.push(`${itemShort[cell.item]}${colorNames[cell.color]} `);
      else cells.push(` ${colorNames[cell.color]}   `);
    }
    console.log(`${8 - row} | ${cells.join('|')}`);
  }
}

function findAllItems(board: (Cell | null)[][]) {
  const items: { row: number; col: number; item: string; color: number }[] = [];
  for (let r = 0; r < BOARD_SIZE; r++)
    for (let c = 0; c < BOARD_SIZE; c++)
      if (board[r][c]?.item) items.push({ row: r, col: c, item: board[r][c]!.item!, color: board[r][c]!.color });
  return items;
}

function findAllObstacles(board: (Cell | null)[][]) {
  const obs: { row: number; col: number; durability: number }[] = [];
  for (let r = 0; r < BOARD_SIZE; r++)
    for (let c = 0; c < BOARD_SIZE; c++)
      if (board[r][c]?.obstacle) obs.push({ row: r, col: c, durability: board[r][c]!.obstacle!.durability });
  return obs;
}

function describeCell(board: (Cell | null)[][], row: number, col: number): string {
  const cell = board[row][col];
  if (!cell) return 'null';
  let d = colorNames[cell.color];
  if (cell.obstacle) d += `/OB${cell.obstacle.durability}`;
  if (cell.item) d += `/${cell.item}`;
  return d;
}

describe('CLEAR mode debug - 2026-04-05', () => {
  const seed = generateDailySeed('2026-04-05');

  function applyMoves(count: number): { state: ReturnType<typeof initializeGame> } {
    let state = initializeGame(seed, 'clear');
    const moves: Action[] = [
      { type: 'swap', pos: { row: 7, col: 2 }, dir: 'right' },  // c1右
      { type: 'swap', pos: { row: 3, col: 3 }, dir: 'up' },     // d5上
      { type: 'swap', pos: { row: 2, col: 4 }, dir: 'left' },   // e6左
      { type: 'swap', pos: { row: 1, col: 5 }, dir: 'left' },   // f7左
      { type: 'swap', pos: { row: 4, col: 4 }, dir: 'right' },  // e4右
      { type: 'swap', pos: { row: 2, col: 4 }, dir: 'right' },  // e6右
      { type: 'swap', pos: { row: 7, col: 5 }, dir: 'right' },  // f1右
    ];
    for (let i = 0; i < Math.min(count, moves.length); i++) {
      state = processAction(state, moves[i]);
    }
    return { state };
  }

  it('trace all 7 moves and verify engine state', () => {
    console.log(`\nSeed: ${seed}`);

    const { state: s0 } = applyMoves(0);
    console.log('\n=== INITIAL ===');
    printBoard(s0.board);
    console.log(`a4: ${describeCell(s0.board, 4, 0)}, Obstacles: ${countObstacles(s0.board)}`);

    for (let m = 1; m <= 7; m++) {
      const { state: before } = applyMoves(m - 1);
      const { state: after } = applyMoves(m);
      const moveNames = ['c1右', 'd5上', 'e6左', 'f7左', 'e4右', 'e6右', 'f1右'];
      console.log(`\n=== MOVE ${m}: ${moveNames[m - 1]} ===`);
      printBoard(after.board);

      const a4b = describeCell(before.board, 4, 0);
      const a4a = describeCell(after.board, 4, 0);
      console.log(`a4: ${a4b} → ${a4a}`);
      console.log(`Score: ${after.score}, Obstacles: ${countObstacles(after.board)}`);

      const items = findAllItems(after.board);
      if (items.length > 0) {
        console.log('Items:', items.map(i => `${posLabel(i.row, i.col)}=${i.item}`).join(', '));
      }

      // Obstacle changes
      const obsBefore = findAllObstacles(before.board);
      const obsAfter = findAllObstacles(after.board);
      for (const ob of obsBefore) {
        const af = obsAfter.find(o => o.row === ob.row && o.col === ob.col);
        if (!af) console.log(`  ${posLabel(ob.row, ob.col)} DESTROYED (was dur=${ob.durability})`);
        else if (af.durability !== ob.durability) console.log(`  ${posLabel(ob.row, ob.col)} dur ${ob.durability} → ${af.durability}`);
      }
    }
  });

  it('BUG PROOF: item placement before processDamage causes different gravity result', () => {
    // When processChains places items BEFORE processDamage, and processDamage
    // destroys an obstacle and calls applyGravity, the item participates in
    // that gravity. This is DIFFERENT from what the frontend does.

    // Create scenario: obstacle below cleared position, item placed at cleared pos
    function makeBoard(): (Cell | null)[][] {
      const b: (Cell | null)[][] = [];
      for (let r = 0; r < BOARD_SIZE; r++) {
        b[r] = [];
        for (let c = 0; c < BOARD_SIZE; c++) {
          b[r][c] = { color: ((r * 3 + c * 7 + 11) % 5) as Color };
        }
      }
      b[5][2] = { color: 1 as Color, obstacle: { durability: 1 } };
      b[4][1] = { color: 3 as Color };
      b[4][2] = { color: 3 as Color };
      b[4][3] = { color: 3 as Color };
      return b;
    }

    const clearedPositions: Position[] = [
      { row: 4, col: 1 }, { row: 4, col: 2 }, { row: 4, col: 3 }
    ];

    // --- ENGINE behavior: item placed, then processDamage (gravity inside) ---
    const boardEngine = makeBoard();
    for (const pos of clearedPositions) boardEngine[pos.row][pos.col] = null;
    boardEngine[4][2] = { color: 0 as Color, item: 'scope' }; // item at cleared pos above obstacle
    const destroyedE = damageObstacles(boardEngine, clearedPositions);
    expect(destroyedE.length).toBe(1); // obstacle at (5,2) destroyed
    applyGravity(boardEngine, true); // processDamage's gravity

    // --- FRONTEND behavior: item placed, damageObstacles only, then single gravity ---
    const boardFE = makeBoard();
    for (const pos of clearedPositions) boardFE[pos.row][pos.col] = null;
    boardFE[4][2] = { color: 0 as Color, item: 'scope' };
    const destroyedF = damageObstacles(boardFE, clearedPositions);
    expect(destroyedF.length).toBe(1);
    // Frontend does NOT call gravity inside damageObstacles; it calls gravity once after
    applyGravity(boardFE, true);

    // Both should be the same here because there's only ONE gravity call in both cases.
    // The difference emerges when processDamage calls gravity+fill, and THEN processChains
    // calls gravity+fill AGAIN. The frontend only does ONE gravity+fill.

    // Now simulate the FULL engine processChains flow vs frontend flow:
    console.log('\n--- Engine flow (processDamage has internal gravity+fill) ---');
    const bEng = makeBoard();
    for (const pos of clearedPositions) bEng[pos.row][pos.col] = null;
    bEng[4][2] = { color: 0 as Color, item: 'scope' };
    // processDamage: damage + gravity + fill (skip fill for comparison)
    damageObstacles(bEng, clearedPositions);
    applyGravity(bEng, true); // processDamage internal gravity
    // Then processChains regular gravity
    applyGravity(bEng, true);
    printBoard(bEng, 'Engine (double gravity):');

    console.log('\n--- Frontend flow (single gravity) ---');
    const bFE = makeBoard();
    for (const pos of clearedPositions) bFE[pos.row][pos.col] = null;
    bFE[4][2] = { color: 0 as Color, item: 'scope' };
    damageObstacles(bFE, clearedPositions);
    // Frontend: only ONE gravity call
    applyGravity(bFE, true);
    printBoard(bFE, 'Frontend (single gravity):');

    // Both gravity results should be identical (double gravity is idempotent)
    // because applyGravity is idempotent - running it twice gives the same result.
    // So the gravity itself is not the issue.

    // The REAL issue is that processDamage also calls fillEmptyCells, which changes
    // the RNG state. The frontend skips this fill, leading to RNG desync, which
    // causes different tiles to appear in subsequent fills.
    console.log('\nDouble gravity is idempotent, so board positions match.');
    console.log('But processDamage also calls fillEmptyCells (RNG-consuming),');
    console.log('which the frontend skips — causing RNG state desync.');
  });

  // 以前ここには、この日付の盤面に固定した期待値（「a4 のおじゃまが dur=2→1」等）を
  // 持つテストが 4 件あった。列RNGの独立性を修正した際に全シードの盤面が変わったため、
  // それらの期待値は成立しなくなっている。
  //
  // これらが守っていた不変条件は、いずれも盤面を明示的に組み立てるテストが個別に
  // カバーしている:
  //   - おじゃまタイルのダメージ・破壊 → obstacle.test.ts
  //   - スワップ後の findItemPosition  → item-swap-position.test.ts
  //   - flush の誘爆とターゲット決定    → flush-chain.test.ts
  //   - フロントエンドフローとの一致    → 本ファイル後半の "FIXED:" 2 件
  //
  // ここには盤面に依存しない結合テストとしての価値だけを残す。
  it('7手のプレイスルーで盤面の整合性が保たれる', () => {
    let prevObstacles = countObstacles(applyMoves(0).state.board);

    for (let m = 1; m <= 7; m++) {
      const { state } = applyMoves(m);

      // 盤面に穴が残らない
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          expect(state.board[r][c], `move ${m}: cell (${r},${c}) が null`).not.toBeNull();
        }
      }

      // おじゃまタイルは増えない（Clear モードは侵食がないため単調非増加）
      const obstacles = countObstacles(state.board);
      expect(obstacles, `move ${m}: おじゃまタイルが増加`).toBeLessThanOrEqual(prevObstacles);
      prevObstacles = obstacles;

      // おじゃまタイルの耐久値は常に 1 以上
      for (const ob of findAllObstacles(state.board)) {
        expect(ob.durability, `move ${m}: (${ob.row},${ob.col}) の耐久値`).toBeGreaterThan(0);
      }

      expect(state.score).toBeGreaterThanOrEqual(0);
    }
  });

  it('同一シード・同一操作で同一結果を返す（決定性）', () => {
    const a = applyMoves(7).state;
    const b = applyMoves(7).state;
    expect(a.score).toBe(b.score);
    expect(a.rngState).toEqual(b.rngState);
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(a.board[r][c]?.color, `cell (${r},${c})`).toBe(b.board[r][c]?.color);
        expect(a.board[r][c]?.obstacle?.durability, `cell (${r},${c}) obstacle`)
          .toBe(b.board[r][c]?.obstacle?.durability);
      }
    }
  });

  it('FIXED: multiple chain steps with obstacle destruction produce consistent RNG between engine and manual flow', () => {
    // おじゃまタイル破壊を含む連鎖で、processDamage と手動フローの
    // RNG状態が一致することを確認。これがズレると以降のfillEmptyCellsで
    // 異なるタイルが生成され、盤面が乖離する。

    function makeBoard(): (Cell | null)[][] {
      const b: (Cell | null)[][] = [];
      for (let r = 0; r < BOARD_SIZE; r++) {
        b[r] = [];
        for (let c = 0; c < BOARD_SIZE; c++) {
          b[r][c] = { color: ((r * 3 + c * 7 + 11) % 5) as Color };
        }
      }
      // 3マッチの隣におじゃまタイル（耐久値1）を配置
      b[4][1] = { color: 3 as Color };
      b[4][2] = { color: 3 as Color };
      b[4][3] = { color: 3 as Color };
      b[5][2] = { color: 1 as Color, obstacle: { durability: 1 } };
      return b;
    }

    const clearedPositions: Position[] = [
      { row: 4, col: 1 }, { row: 4, col: 2 }, { row: 4, col: 3 }
    ];

    // --- processDamage フロー ---
    const boardA = makeBoard();
    for (const p of clearedPositions) boardA[p.row][p.col] = null;
    const rngA = [100, 200, 300, 400, 500, 600, 700, 800]; // 8列分
    const rngAfterA = processDamage(boardA, clearedPositions, [...rngA], 'clear');

    // --- 修正後フロントエンドフロー: damageObstacles + gravity + fill ---
    const boardB = makeBoard();
    for (const p of clearedPositions) boardB[p.row][p.col] = null;
    const rngB = [...rngA];
    const destroyed = damageObstacles(boardB, clearedPositions);
    let rngAfterB = rngB;
    if (destroyed.length > 0) {
      applyGravity(boardB, true); // clear mode
      rngAfterB = fillEmptyCells(boardB, rngAfterB, NUM_COLORS);
    }

    // 盤面一致
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(boardA[r][c]?.color, `cell (${r},${c}) color`).toBe(boardB[r][c]?.color);
        expect(boardA[r][c]?.obstacle?.durability, `cell (${r},${c}) obstacle`).toBe(boardB[r][c]?.obstacle?.durability);
      }
    }

    // RNG状態一致
    expect(rngAfterA).toEqual(rngAfterB);
  });

  it('FIXED: obstacle destruction without adjacent damage does not trigger unnecessary gravity+fill', () => {
    // 消去位置がおじゃまタイルに隣接しない場合、damageObstacles は何も破壊せず
    // gravity+fill が実行されないことを確認

    const board = makeBoard();
    function makeBoard(): (Cell | null)[][] {
      const b: (Cell | null)[][] = [];
      for (let r = 0; r < BOARD_SIZE; r++) {
        b[r] = [];
        for (let c = 0; c < BOARD_SIZE; c++) {
          b[r][c] = { color: ((r + c) % 5) as Color };
        }
      }
      b[0][0] = { color: 0 as Color, obstacle: { durability: 3 } };
      return b;
    }

    // (7,7) を消去 — (0,0) のおじゃまには隣接しない
    const clearedPositions: Position[] = [{ row: 7, col: 7 }];
    board[7][7] = null;

    const rng = [100, 200, 300, 400, 500, 600, 700, 800];
    const rngBefore = [...rng];
    const rngAfter = processDamage(board, clearedPositions, rng, 'clear');

    // RNG状態は変化しない（gravity+fillが実行されていない）
    expect(rngAfter).toEqual(rngBefore);
    // おじゃまタイルは無傷
    expect(board[0][0]?.obstacle?.durability).toBe(3);
  });
});
