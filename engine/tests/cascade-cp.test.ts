import { describe, it, expect } from 'vitest';
import { initializeGame, processAction, processScopeSwap } from '../src/engine.js';
import { computeScopeSwapPreChains } from '../src/trace.js';
import { findMatches } from '../src/match.js';
import { Action, BOARD_SIZE, Cell, Color, GameState } from '../src/types.js';
import type { ChainStepData } from '../src/traceCollector.js';

/** マッチのない盤面（周期パターン: color = (row * 2 + col) % 4） */
function noMatchBoard(): (Cell | null)[][] {
  const board: (Cell | null)[][] = Array.from({ length: BOARD_SIZE }, (_, r) =>
    Array.from({ length: BOARD_SIZE }, (_, c) => ({ color: ((r * 2 + c) % 4) as Color })));
  expect(findMatches(board)).toHaveLength(0);
  return board;
}

function cascadeState(seed: number, board: (Cell | null)[][]): GameState {
  const state = initializeGame(seed, 'cascade');
  state.board = board;
  return state;
}

/** 同じ盤面で、指定マスのキラキラの有無だけが違う2つの状態 */
function withAndWithoutSparkles(seed: number, build: () => (Cell | null)[][], sparkles: [number, number][]) {
  const plain = build();
  const sparkly = build();
  for (const [r, c] of sparkles) sparkly[r][c]!.sparkle = true;
  return { plain: cascadeState(seed, plain), sparkly: cascadeState(seed, sparkly) };
}

describe('Cascade CP: sparkles cleared by item effects', () => {
  it('tap: sparkles cleared by the item add CP', () => {
    const build = () => {
      const board = noMatchBoard();
      board[0][0] = { color: 0, item: 'v_cut' };
      return board;
    };
    const column0 = Array.from({ length: 7 }, (_, i) => [i + 1, 0] as [number, number]);
    const { plain, sparkly } = withAndWithoutSparkles(777, build, column0);

    const tap = { type: 'tap', pos: { row: 0, col: 0 } } as const;
    expect(processAction(sparkly, tap).cascadePoints! - processAction(plain, tap).cascadePoints!).toBe(7);
  });

  it('scope: sparkles cleared around the scope and on the selected cell add CP', () => {
    const build = () => {
      const board = noMatchBoard();
      board[3][3] = { color: 0, item: 'scope' };
      return board;
    };
    const { plain, sparkly } = withAndWithoutSparkles(777, build, [[2, 3], [7, 7]]);

    const scope: Action = { type: 'scope', pos: { row: 3, col: 3 }, targetCells: [{ row: 7, col: 7 }] };
    expect(processAction(sparkly, scope).cascadePoints! - processAction(plain, scope).cascadePoints!).toBe(2);
  });

  it('synthesis: sparkles cleared by salad bowl x salad bowl add CP', () => {
    const build = () => {
      const board = noMatchBoard();
      board[4][4] = { color: 0, item: 'flush' };
      board[4][5] = { color: 0, item: 'flush' };
      return board;
    };
    const { plain, sparkly } = withAndWithoutSparkles(777, build, [[0, 0], [7, 7], [2, 5]]);

    const swap = { type: 'swap', pos: { row: 4, col: 4 }, dir: 'right' } as const;
    expect(processAction(sparkly, swap).cascadePoints! - processAction(plain, swap).cascadePoints!).toBe(3);
  });
});

describe('Cascade: sparkle refill', () => {
  it('tiles refilled after salad bowl x salad bowl can be sparkles', () => {
    let refilledSparkles = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const board = noMatchBoard();
      board[4][4] = { color: 0, item: 'flush' };
      board[4][5] = { color: 0, item: 'flush' };
      let afterDrop: (Cell | null)[][] | undefined;
      processAction(cascadeState(seed, board), { type: 'swap', pos: { row: 4, col: 4 }, dir: 'right' }, {
        onBoardSnapshot: (label, b) => { if (label === 'afterItemDrop') afterDrop = b; },
      });
      refilledSparkles += afterDrop!.flat().filter((c) => c?.sparkle).length;
    }
    expect(refilledSparkles).toBeGreaterThan(0);
  });
});

/** 行7に「1,1,アイテム,1」を置き、(7,3) を左に入れ替えると行7で3マッチ（事前連鎖）が起きる盤面 */
function preChainBoard(item: 'v_cut' | 'scope'): (Cell | null)[][] | null {
  const board = noMatchBoard();
  for (let c = 0; c < BOARD_SIZE; c++) board[7][c] = { color: ((c * 3) % 4) as Color };
  board[7][0] = { color: 1, sparkle: true };
  board[7][1] = { color: 1 };
  board[7][2] = { color: 0, item };
  board[7][3] = { color: 1 };
  board[6][0] = { color: 2 }; board[6][1] = { color: 3 }; board[6][2] = { color: 2 }; board[6][3] = { color: 3 };
  return findMatches(board).length === 0 ? board : null;
}

describe('Cascade: lastChainCount keeps the deepest chain of the action', () => {
  it('item swipe: pre-chains are not overwritten by the chains after the item', () => {
    let observed = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const board = preChainBoard('v_cut');
      if (!board) continue;
      const chains: ChainStepData[] = [];
      const next = processAction(cascadeState(seed, board), { type: 'swap', pos: { row: 7, col: 3 }, dir: 'left' }, {
        onChainStep: (s) => chains.push(s),
      });
      if (chains.length === 0) continue;
      expect(next.lastChainCount).toBe(Math.max(...chains.map((c) => c.chainIndex)));
      observed++;
    }
    expect(observed).toBeGreaterThan(0);
  });

  it('scope swap: the pre-chains count toward lastChainCount', () => {
    let observed = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const board = preChainBoard('scope');
      if (!board) continue;
      const chains: ChainStepData[] = [];
      const next = processScopeSwap(cascadeState(seed, board), { row: 7, col: 3 }, 'left', [{ row: 0, col: 7 }], {
        onChainStep: (s) => chains.push(s),
      });
      if (chains.length === 0) continue;
      expect(next.lastChainCount).toBe(Math.max(...chains.map((c) => c.chainIndex)));
      observed++;
    }
    expect(observed).toBeGreaterThan(0);
  });
});

describe('Cascade: scope swap in the frontend flow matches processScopeSwap', () => {
  it('computeScopeSwapPreChains + scope action gives the same CP as processScopeSwap', () => {
    let observed = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const board = preChainBoard('scope');
      if (!board) continue;
      const state = cascadeState(seed, board);
      const pos = { row: 7, col: 3 };
      const pre = computeScopeSwapPreChains(state, pos, 'left');
      if (!pre || pre.preChains.length === 0) continue;

      const targetCells = [{ row: 0, col: 7 }];
      // PuzzleBoard.vue と同じ流れ: 事前連鎖後の状態を適用してからスプーンを発動する
      const frontend = processAction(pre.stateAfterPreChains, { type: 'scope', pos: pre.scopePos, targetCells });
      const engine = processScopeSwap(state, pos, 'left', targetCells);

      expect(frontend.board).toEqual(engine.board);
      expect(frontend.score).toBe(engine.score);
      expect(frontend.cascadePoints).toBe(engine.cascadePoints);
      expect(frontend.maxChainIndex).toBe(engine.maxChainIndex);
      expect(frontend.milestonesClaimed).toEqual(engine.milestonesClaimed);
      observed++;
    }
    expect(observed).toBeGreaterThan(0);
  });
});
