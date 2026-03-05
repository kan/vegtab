import { describe, it, expect } from 'vitest';
import { determineItem, getSynthesisEffect } from '../src/item.js';
import { Match, Color } from '../src/types.js';

describe('Item Generation', () => {
  it('3マス以下ではアイテム生成なし', () => {
    const match: Match = {
      positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }],
      color: 0 as Color,
    };
    expect(determineItem(match)).toBeNull();
  });

  it('横4マスではさみを生成', () => {
    const match: Match = {
      positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 0, col: 3 }],
      color: 0 as Color,
    };
    expect(determineItem(match)).toBe('scissors');
  });

  it('縦4マスでカッターを生成', () => {
    const match: Match = {
      positions: [{ row: 0, col: 0 }, { row: 1, col: 0 }, { row: 2, col: 0 }, { row: 3, col: 0 }],
      color: 0 as Color,
    };
    expect(determineItem(match)).toBe('cutter');
  });

  it('5マス直線でコーヒーカップを生成', () => {
    const match: Match = {
      positions: [
        { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 },
        { row: 0, col: 3 }, { row: 0, col: 4 },
      ],
      color: 0 as Color,
    };
    expect(determineItem(match)).toBe('coffee');
  });

  it('5マス非直線でクリップを生成', () => {
    const match: Match = {
      positions: [
        { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 },
        { row: 1, col: 0 }, { row: 2, col: 0 },
      ],
      color: 0 as Color,
    };
    expect(determineItem(match)).toBe('clip');
  });
});

describe('Item Synthesis', () => {
  it('はさみ+はさみ → line+line', () => {
    expect(getSynthesisEffect('scissors', 'scissors')?.effect).toBe('line+line');
  });

  it('はさみ+カッター → line+line', () => {
    expect(getSynthesisEffect('scissors', 'cutter')?.effect).toBe('line+line');
  });

  it('カッター+カッター → line+line', () => {
    expect(getSynthesisEffect('cutter', 'cutter')?.effect).toBe('line+line');
  });

  it('はさみ+クリップ → scissors+clip', () => {
    expect(getSynthesisEffect('scissors', 'clip')?.effect).toBe('scissors+clip');
  });

  it('カッター+クリップ → cutter+clip', () => {
    expect(getSynthesisEffect('cutter', 'clip')?.effect).toBe('cutter+clip');
  });

  it('クリップ+クリップ → clip+clip', () => {
    expect(getSynthesisEffect('clip', 'clip')?.effect).toBe('clip+clip');
  });

  it('コーヒー+はさみ → coffee+scissors', () => {
    expect(getSynthesisEffect('coffee', 'scissors')?.effect).toBe('coffee+scissors');
  });

  it('コーヒー+コーヒー → coffee+coffee', () => {
    expect(getSynthesisEffect('coffee', 'coffee')?.effect).toBe('coffee+coffee');
  });
});
