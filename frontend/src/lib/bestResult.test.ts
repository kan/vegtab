import { describe, it, expect } from 'vitest';
import { isBetterResult } from './bestResult';

const r = (isCleared: boolean, moves: number, score: number) => ({ isCleared, moves, score });

describe('isBetterResult', () => {
  it('クリアした記録は失敗した記録より良い（手数やスコアに関係なく）', () => {
    expect(isBetterResult(r(true, 30, 100), r(false, 3, 9999))).toBe(true);
    expect(isBetterResult(r(false, 3, 9999), r(true, 30, 100))).toBe(false);
  });

  it('どちらもクリアなら少ない手数、同じ手数なら高いスコアが良い', () => {
    expect(isBetterResult(r(true, 5, 100), r(true, 6, 900))).toBe(true);
    expect(isBetterResult(r(true, 6, 900), r(true, 5, 100))).toBe(false);
    expect(isBetterResult(r(true, 5, 200), r(true, 5, 100))).toBe(true);
    expect(isBetterResult(r(true, 5, 100), r(true, 5, 100))).toBe(false);
  });

  it('どちらも失敗なら置き換えない（サーバーの upsert と同じ）', () => {
    expect(isBetterResult(r(false, 3, 9999), r(false, 10, 1))).toBe(false);
  });
});
