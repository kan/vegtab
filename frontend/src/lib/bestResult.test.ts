import { describe, it, expect } from 'vitest';
import { isBetterResult } from './bestResult';

const r = (isCleared: boolean, moves: number, timeMs: number | null = null) => ({ isCleared, moves, timeMs });

describe('isBetterResult', () => {
  it('クリアした記録は失敗した記録より良い（手数や時間に関係なく）', () => {
    expect(isBetterResult(r(true, 30, 999_000), r(false, 3, 1_000))).toBe(true);
    expect(isBetterResult(r(false, 3, 1_000), r(true, 30, 999_000))).toBe(false);
  });

  it('どちらもクリアなら少ない手数、同じ手数なら短い時間が良い', () => {
    expect(isBetterResult(r(true, 5, 90_000), r(true, 6, 10_000))).toBe(true);
    expect(isBetterResult(r(true, 6, 10_000), r(true, 5, 90_000))).toBe(false);
    expect(isBetterResult(r(true, 5, 60_000), r(true, 5, 90_000))).toBe(true);
    expect(isBetterResult(r(true, 5, 90_000), r(true, 5, 90_000))).toBe(false);
  });

  it('時間の記録がない記録は、同じ手数の中で最も遅い扱い', () => {
    expect(isBetterResult(r(true, 5, 90_000), r(true, 5, null))).toBe(true);
    expect(isBetterResult(r(true, 5, null), r(true, 5, 90_000))).toBe(false);
    expect(isBetterResult(r(true, 5, null), r(true, 5, null))).toBe(false);
  });

  it('どちらも失敗なら置き換えない（サーバーの upsert と同じ）', () => {
    expect(isBetterResult(r(false, 3), r(false, 10))).toBe(false);
  });
});
