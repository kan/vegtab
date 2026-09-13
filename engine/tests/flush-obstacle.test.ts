import { describe, it, expect } from 'vitest';
import { findFlushTargetColor, getFlushTargets } from '../src/item.js';
import { BOARD_SIZE, Cell, Color } from '../src/types.js';

/**
 * おじゃまタイルは配置前のタイルの色を内部に保持している。
 * サラダボウルがその見えない色を対象色にしたり、消す対象に含めたりしないことを確認する。
 */

/** 5色の周期パターンの盤面: color = (row * 2 + col) % 5 */
function patternBoard(): (Cell | null)[][] {
  return Array.from({ length: BOARD_SIZE }, (_, r) =>
    Array.from({ length: BOARD_SIZE }, (_, c) => ({ color: ((r * 2 + c) % 5) as Color })));
}

describe('findFlushTargetColor', () => {
  it('skips an obstacle neighbor and uses the next visible tile', () => {
    const board = patternBoard();
    board[3][3] = { color: 0, item: 'flush' };
    // 上隣 (2,3) は色 2 のおじゃま、次に見る右上 (2,4) は色 3
    board[2][3] = { color: 2, obstacle: { durability: 3 } };

    expect(findFlushTargetColor(board, { row: 3, col: 3 })).toBe(3);
  });

  it('returns null when every neighbor is an obstacle or an item', () => {
    const board = patternBoard();
    board[0][0] = { color: 0, item: 'flush' };
    board[0][1] = { color: 1, obstacle: { durability: 1 } };
    board[1][0] = { color: 2, obstacle: { durability: 1 } };
    board[1][1] = { color: 3, item: 'burst' };

    expect(findFlushTargetColor(board, { row: 0, col: 0 })).toBeNull();
  });
});

describe('getFlushTargets', () => {
  it('does not include obstacles whose hidden color matches', () => {
    const board = patternBoard();
    board[0][3] = { color: 3, obstacle: { durability: 3 } };

    const targets = getFlushTargets(board, 3);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets).not.toContainEqual({ row: 0, col: 3 });
  });
});
