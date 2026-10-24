import { describe, it, expect } from 'vitest';
import { initializeGame, processAction, processScopeSwap } from '../src/engine.js';
import { countLocks, countLockLayers, allLocksCleared } from '../src/lock.js';
import { countObstacles } from '../src/obstacle.js';
import { hasValidSwap } from '../src/gameOver.js';
import { applyGravity } from '../src/gravity.js';
import { computeDropMoves } from '../src/dropMoves.js';
import { determineItemFromMatches } from '../src/item.js';
import { createColumnRngStates, createEmptyBoard } from '../src/board.js';
import { createRng } from '../src/rng.js';
import { Cell, Color, GameState, BOARD_SIZE } from '../src/types.js';

/** マッチも 2×2 も無い盤: 色は (2 × 行 + 列) mod 5 */
function background(r: number, c: number): Cell {
  return { color: ((r * 2 + c) % 5) as Color };
}

type Override = [row: number, col: number, cell: Cell];

function stateWith(overrides: Override[]): GameState {
  const board: (Cell | null)[][] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    board.push([]);
    for (let c = 0; c < BOARD_SIZE; c++) board[r].push(background(r, c));
  }
  for (const [r, c, cell] of overrides) board[r][c] = cell;
  return {
    board, score: 0, moveCount: 0, isGameOver: false, maxChainIndex: 0,
    rngState: createColumnRngStates(createRng(1)),
  };
}

const v = (color: number, lock?: number): Cell => (lock ? { color: color as Color, lock } : { color: color as Color });


describe('鎖の配置（initializeGame の locks）', () => {
  it('指定した数の鎖を置き、おじゃまは置かない。2 段の数も指定どおり', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const st = initializeGame(seed, { locks: { count: 12, double: 4 } });
      expect(countLocks(st.board)).toBe(12);
      expect(countLockLayers(st.board)).toBe(16);
      expect(countObstacles(st.board)).toBe(0);
    }
  });

  it('同じシードなら同じ配置になる（決定性）', () => {
    const a = initializeGame(777, { locks: { count: 10, double: 3 } });
    const b = initializeGame(777, { locks: { count: 10, double: 3 } });
    expect(a).toEqual(b);
  });

  it('野菜の並びは同じシードの Clear と同じで、鎖の位置だけが加わる', () => {
    const clear = initializeGame(123);
    const lock = initializeGame(123, { locks: { count: 8, double: 0 } });
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (!clear.board[r][c]?.obstacle) expect(lock.board[r][c]?.color).toBe(clear.board[r][c]?.color);
      }
    }
  });
});

describe('鎖の付いた野菜の入れ替え', () => {
  it('鎖の付いた野菜は入れ替えられない（マッチができる入れ替えでも）', () => {
    // (7,0) を鎖付きの色 1 にし、(7,1)(7,2)=1 の並びの左端へ入れ替えようとする
    const st = stateWith([[7, 1, v(1)], [7, 2, v(1)], [6, 0, v(1, 1)]]);
    const next = processAction(st, { type: 'swap', pos: { row: 6, col: 0 }, dir: 'down' });
    expect(next).toBe(st);
  });

  it('鎖の付いた野菜とスプーンの入れ替えもできない', () => {
    const st = stateWith([[6, 0, v(1, 1)], [7, 0, { color: 0, item: 'scope' }]]);
    const next = processScopeSwap(st, { row: 7, col: 0 }, 'up', [{ row: 0, col: 0 }]);
    expect(next).toBe(st);
  });

  it('詰みの判定でも鎖の野菜を入れ替えの候補にしない', () => {
    // 盤の全部に鎖を付けると、マッチができる並びがあっても有効な手は無い
    const st = stateWith([[7, 1, v(1)], [7, 2, v(1)], [6, 0, v(1)]]);
    expect(hasValidSwap(st.board)).toBe(true);
    for (const row of st.board) for (const cell of row) cell!.lock = 1;
    expect(hasValidSwap(st.board)).toBe(false);
  });
});

describe('マッチで鎖が外れる', () => {
  it('鎖の付いた野菜がマッチに入ると鎖が外れ、野菜はその場に残る。ほかの 2 つは消える', () => {
    // (7,0) が鎖付きの色 1。(6,1) の色 1 を下へ入れ替えて (7,0)(7,1)(7,2) を揃える
    const st = stateWith([[7, 0, v(1, 1)], [7, 2, v(1)], [6, 1, v(1)], [7, 1, v(3)]]);
    const next = processAction(st, { type: 'swap', pos: { row: 6, col: 1 }, dir: 'down' });
    expect(next).not.toBe(st);
    expect(next.moveCount).toBe(1);
    expect(next.board[7][0]?.lock).toBeUndefined();
    expect(next.board[7][0]?.color).toBe(1);
    expect(allLocksCleared(next.board)).toBe(true);
    expect(next.isCleared).toBe(true);
    expect(next.isGameOver).toBe(true);
  });

  it('2 段の鎖は 1 回のマッチで 1 段だけ外れる', () => {
    const st = stateWith([[7, 0, v(1, 2)], [7, 2, v(1)], [6, 1, v(1)], [7, 1, v(3)]]);
    const next = processAction(st, { type: 'swap', pos: { row: 6, col: 1 }, dir: 'down' });
    expect(next.board[7][0]?.lock).toBe(1);
    expect(next.isGameOver).toBe(false);
  });

  it('隣でマッチしても鎖は外れない（おじゃまとの違い）', () => {
    // (6,0) に鎖。行 7 の列 0〜2 を色 2 で揃える（(6,0) は消えたマスの真上で隣）
    const st = stateWith([[6, 0, v(0, 1)], [7, 0, v(2)], [7, 2, v(2)], [6, 1, v(2)], [7, 1, v(3)]]);
    const next = processAction(st, { type: 'swap', pos: { row: 6, col: 1 }, dir: 'down' });
    expect(next).not.toBe(st);
    expect(next.board[6][0]?.lock).toBe(1);
  });

  it('連鎖で生まれるアイテムは、鎖の付いた野菜を避けて置く', () => {
    // 入れ替えの無い 4 直線の中央は (0,2)。そこが鎖なら、残りの中から選ぶ
    const match = { positions: [0, 1, 2, 3].map(col => ({ row: 0, col })), color: 1 as Color };
    expect(determineItemFromMatches([match])).toEqual([{ item: 'v_cut', pos: { row: 0, col: 2 } }]);
    const blocked = (p: { row: number; col: number }) => p.row === 0 && p.col === 2;
    const placed = determineItemFromMatches([match], undefined, blocked);
    expect(placed).toHaveLength(1);
    expect(placed[0].pos).not.toEqual({ row: 0, col: 2 });
    // 全部が置けないときはアイテムを作らない
    expect(determineItemFromMatches([match], undefined, () => true)).toEqual([]);
  });

  it('上位のアイテムの置き場所が無いときは、置ける下位のアイテムを作る', () => {
    // 縦 4 直線（ハサミ）と、それに重なる 2×2（スプーン）。直線の 4 マス（列 0）は全部鎖で、2×2 の列 1 は空いている。
    // ハサミは置けないので、2×2 のスプーンが列 1 に作られる
    const line = { positions: [0, 1, 2, 3].map(row => ({ row, col: 0 })), color: 1 as Color };
    const square = {
      positions: [{ row: 2, col: 0 }, { row: 2, col: 1 }, { row: 3, col: 0 }, { row: 3, col: 1 }],
      color: 1 as Color, shape: '2x2' as const,
    };
    const blocked = (p: { row: number; col: number }) => p.col === 0;
    const placed = determineItemFromMatches([line, square], undefined, blocked);
    expect(placed).toHaveLength(1);
    expect(placed[0].pos.col).toBe(1);
  });
});

describe('アイテムで鎖が外れる', () => {
  it('ハサミの範囲に入った鎖は 1 段外れ、野菜は残る', () => {
    const st = stateWith([[3, 4, { color: 0, item: 'v_cut' }], [0, 4, v(2, 1)], [6, 4, v(3, 2)]]);
    const next = processAction(st, { type: 'tap', pos: { row: 3, col: 4 } });
    expect(next).not.toBe(st);
    // 鎖の野菜は消えずに同じ位置に残る（2 段の方は、その後の連鎖でさらに外れることがある）
    expect(next.board[0][4]?.lock).toBeUndefined();
    expect(next.board[0][4]?.color).toBe(2);
    expect(next.board[6][4]?.lock ?? 0).toBeLessThan(2);
    expect(next.board[6][4]?.color).toBe(3);
  });

  it('スプーンの周囲と選んだマスでも鎖が外れる', () => {
    const st = stateWith([[4, 4, { color: 0, item: 'scope' }], [3, 4, v(0, 1)], [0, 0, v(0, 1)]]);
    const next = processAction(st, { type: 'scope', pos: { row: 4, col: 4 }, targetCells: [{ row: 0, col: 0 }] });
    expect(next.board[3][4]?.lock).toBeUndefined();
    expect(next.board[0][0]?.lock).toBeUndefined();
    expect(next.isCleared).toBe(true);
  });
});

describe('落下', () => {
  it('鎖の付いた野菜は落ちず、上のタイルはすり抜けて落ちる', () => {
    const board: (Cell | null)[][] = createEmptyBoard();
    board[5][0] = v(1, 1);
    board[2][0] = v(3);
    // ほかのマス（行 6, 7 を含む）は空き
    const moves = computeDropMoves(board);
    applyGravity(board);
    expect(board[5][0]?.lock).toBe(1);
    expect(board[7][0]?.color).toBe(3);
    expect(moves.moves).toContainEqual({ col: 0, fromRow: 2, toRow: 7 });
  });
});
