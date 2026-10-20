import { describe, it, expect } from 'vitest';
import { initializeGame, processAction, processScopeSynthesis, processScopeSwap } from '../src/engine.js';
import { findMatches } from '../src/match.js';
import { BOARD_SIZE, Cell, Color, Direction, GameState, ItemType, Position } from '../src/types.js';

/**
 * リプレイ検証（backend の verifyReplay）は engine が受理した操作を正当とみなす。
 * フロントが送らない不正な操作は state をそのまま返すことを確認する。
 */

type Placement = [row: number, col: number, item: ItemType];

/** マッチのない盤面（5色の周期パターン）に、指定のアイテムを置いた state */
function stateWith(items: Placement[] = []): GameState {
  const board: (Cell | null)[][] = Array.from({ length: BOARD_SIZE }, (_, r) =>
    Array.from({ length: BOARD_SIZE }, (_, c) => ({ color: ((r * 2 + c) % 5) as Color })));
  expect(findMatches(board)).toHaveLength(0);
  for (const [row, col, item] of items) board[row][col] = { color: 0, item };
  const state = initializeGame(12345);
  state.board = board;
  return state;
}

const cell = (row: number, col: number): Position => ({ row, col });
const allCells = (): Position[] =>
  Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, i) => cell(Math.floor(i / BOARD_SIZE), i % BOARD_SIZE));

describe('scope アクションの選択マス検証', () => {
  const scopePos = cell(3, 3);

  it('選択マスが 1 つなら発動する', () => {
    const state = stateWith([[3, 3, 'scope']]);
    const next = processAction(state, { type: 'scope', pos: scopePos, targetCells: [cell(0, 0)] });
    expect(next).not.toBe(state);
    expect(next.moveCount).toBe(1);
  });

  it.each([
    ['全マス指定', allCells()],
    ['0 個', []],
    ['重複', [cell(0, 0), cell(0, 0)]],
    ['盤外', [cell(8, 0)]],
    ['非整数', [cell(0.5, 0)]],
  ])('%s は無効', (_label, targetCells) => {
    const state = stateWith([[3, 3, 'scope']]);
    expect(processAction(state, { type: 'scope', pos: scopePos, targetCells })).toBe(state);
  });

  it('targetCells が無くても例外にならず無効', () => {
    const state = stateWith([[3, 3, 'scope']]);
    const action = { type: 'scope', pos: scopePos } as unknown as Parameters<typeof processAction>[1];
    expect(processAction(state, action)).toBe(state);
  });
});

describe('processScopeSynthesis の検証', () => {
  it.each<[string, Placement[], Position, Position, Position[]]>([
    ['スプーン×ハサミは 1 マス選択', [[3, 3, 'scope'], [3, 4, 'v_cut']], cell(3, 3), cell(3, 4), [cell(0, 0)]],
    ['スプーン×スプーンは 3 マス選択', [[3, 3, 'scope'], [4, 3, 'scope']], cell(3, 3), cell(4, 3), [cell(0, 0), cell(0, 1), cell(7, 7)]],
  ])('%s で発動する', (_label, items, pos1, pos2, targets) => {
    const state = stateWith(items);
    const next = processScopeSynthesis(state, pos1, pos2, targets);
    expect(next).not.toBe(state);
    expect(next.moveCount).toBe(1);
  });

  it.each<[string, Placement[], Position, Position, Position[]]>([
    ['スプーン×スプーンで選択マスが 1 つ', [[3, 3, 'scope'], [4, 3, 'scope']], cell(3, 3), cell(4, 3), [cell(0, 0)]],
    ['離れた 2 マス', [[0, 0, 'scope'], [7, 7, 'v_cut']], cell(0, 0), cell(7, 7), [cell(3, 3)]],
    ['スプーンを含まない合成', [[3, 3, 'v_cut'], [3, 4, 'h_cut']], cell(3, 3), cell(3, 4), [cell(0, 0)]],
    ['選択を伴わないスプーン×サラダボウル', [[3, 3, 'scope'], [3, 4, 'flush']], cell(3, 3), cell(3, 4), [cell(0, 0)]],
  ])('%s は無効', (_label, items, pos1, pos2, targets) => {
    const state = stateWith(items);
    expect(processScopeSynthesis(state, pos1, pos2, targets)).toBe(state);
  });
});

describe('processScopeSwap の検証', () => {
  it('スプーンと野菜の入れ替えは発動する', () => {
    const state = stateWith([[2, 2, 'scope']]);
    const next = processScopeSwap(state, cell(2, 2), 'right', [cell(7, 7)]);
    expect(next).not.toBe(state);
    expect(next.moveCount).toBe(1);
  });

  it.each<[string, Placement[], Direction, Position[]]>([
    ['スプーンがない（任意の入れ替えにならない）', [], 'right', [cell(7, 7)]],
    ['相手もアイテム', [[2, 2, 'scope'], [2, 3, 'burst']], 'right', [cell(7, 7)]],
    ['選択マスが 2 つ', [[2, 2, 'scope']], 'right', [cell(7, 7), cell(7, 6)]],
  ])('%s なら無効', (_label, items, dir, targets) => {
    const state = stateWith(items);
    expect(processScopeSwap(state, cell(2, 2), dir, targets)).toBe(state);
  });
});
