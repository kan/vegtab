import { describe, it, expect } from 'vitest';
import { initializeGame, processAction } from '../src/engine.js';
import { findMatches } from '../src/match.js';
import { BOARD_SIZE, Cell, Color, GameState } from '../src/types.js';
import type { ChainStepData, ItemEffectData, TraceCollector } from '../src/traceCollector.js';

/**
 * SPEC §3.6.1: アイテム効果の後に続く連鎖は「誘爆の段数 + 1」連鎖目から数える。
 * 起動したアイテム（スプーン・合成ではその効果）を1段目とし、同じ深さの誘爆は何個でも1段。
 */

/** マッチのない盤面（周期パターン: color = (row * 2 + col) % numColors） */
function noMatchBoard(numColors: number): (Cell | null)[][] {
  const board: (Cell | null)[][] = Array.from({ length: BOARD_SIZE }, (_, r) =>
    Array.from({ length: BOARD_SIZE }, (_, c) => ({ color: ((r * 2 + c) % numColors) as Color })));
  expect(findMatches(board)).toHaveLength(0);
  return board;
}

type Run = {
  /** タイルを消したアイテム発動の数 */
  clearingActivations: number;
  /** タイルを消したアイテム発動の最も深い段（アイテム自身の発動が1段目。スプーンの消去そのものは含まない） */
  itemDepthLevels: number;
  chains: ChainStepData[];
};

/**
 * 複数のシードで盤面にアイテムを置いて操作し、アイテム効果の後に連鎖が起きたケースだけを確かめる。
 * 補充されるタイルはシードで決まるので、連鎖が起きるシードが少なくとも1つあることも確かめる。
 */
function forSeedsWithChains(
  plant: (board: (Cell | null)[][]) => void,
  act: (state: GameState, collector: TraceCollector) => GameState,
  check: (run: Run) => void,
) {
  let observed = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const state = initializeGame(seed, 'sprint');
    plant(state.board);

    const effects: ItemEffectData[] = [];
    const chains: ChainStepData[] = [];
    act(state, { onItemEffect: (e) => effects.push(e), onChainStep: (s) => chains.push(s) });
    if (chains.length === 0) continue;

    const clearing = effects.filter((e) => e.targets.length > 0);
    check({
      clearingActivations: clearing.length,
      itemDepthLevels: Math.max(0, ...clearing.map((e) => e.depth + 1)),
      chains,
    });
    observed++;
  }
  expect(observed).toBeGreaterThan(0);
}

describe('chain index after item effects', () => {
  it('tapping an item and swiping it along the same column give the same result', () => {
    const board = noMatchBoard(4);
    board[0][0] = { color: 0, item: 'v_cut' };
    board[4][0] = { color: 0, item: 'burst' }; // v_cut で誘爆される
    const state = initializeGame(4242, 'cascade');
    state.board = board;

    const tap = processAction(state, { type: 'tap', pos: { row: 0, col: 0 } });
    const swap = processAction(state, { type: 'swap', pos: { row: 0, col: 0 }, dir: 'down' });

    expect(tap.board).toEqual(swap.board);
    expect(tap.score).toBe(swap.score);
    expect(tap.cascadePoints).toBe(swap.cascadePoints);
    expect(tap.lastChainCount).toBe(swap.lastChainCount);
  });

  it('tap: chains start after the deepest detonation', () => {
    forSeedsWithChains(
      (board) => {
        board[0][0] = { color: 0, item: 'v_cut' };
        board[4][0] = { color: 0, item: 'burst' };
      },
      (state, collector) => processAction(state, { type: 'tap', pos: { row: 0, col: 0 } }, collector),
      ({ itemDepthLevels, chains }) => {
        expect(itemDepthLevels).toBe(2);
        expect(chains[0].chainIndex).toBe(3);
      },
    );
  });

  it('tap: items detonated at the same depth count as one level, however many there are', () => {
    forSeedsWithChains(
      (board) => {
        board[3][3] = { color: 0, item: 'burst' };
        // 食器セット（半径2）の範囲の隅に置いたスプーン。互いの隣にはないので、全員が同じ深さで止まる
        board[1][1] = { color: 0, item: 'scope' };
        board[1][5] = { color: 0, item: 'scope' };
        board[5][1] = { color: 0, item: 'scope' };
      },
      (state, collector) => processAction(state, { type: 'tap', pos: { row: 3, col: 3 } }, collector),
      ({ clearingActivations, itemDepthLevels, chains }) => {
        expect(clearingActivations).toBe(4);
        expect(itemDepthLevels).toBe(2);
        expect(chains[0].chainIndex).toBe(3);
      },
    );
  });

  it('scope: the scope clear is the first level and the detonated item the second', () => {
    forSeedsWithChains(
      (board) => {
        board[3][3] = { color: 0, item: 'scope' };
        board[3][4] = { color: 0, item: 'v_cut' }; // 周囲4マスの消去で誘爆される
      },
      (state, collector) =>
        processAction(state, { type: 'scope', pos: { row: 3, col: 3 }, targetCells: [{ row: 7, col: 0 }] }, collector),
      ({ itemDepthLevels, chains }) => {
        expect(itemDepthLevels).toBe(1);
        expect(chains[0].chainIndex).toBe(3);
      },
    );
  });
});
