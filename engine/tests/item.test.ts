import { describe, it, expect } from 'vitest';
import { determineItem, determineItemFromMatches, getSynthesisEffect } from '../src/item.js';
import { Match, Color } from '../src/types.js';

describe('Item Generation', () => {
  it('3マス以下ではアイテム生成なし', () => {
    const match: Match = {
      positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }],
      color: 0 as Color,
    };
    expect(determineItem(match)).toBeNull();
  });

  it('横4マスでv_cutを生成', () => {
    const match: Match = {
      positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 0, col: 3 }],
      color: 0 as Color,
    };
    expect(determineItem(match)).toBe('v_cut');
  });

  it('縦4マスでh_cutを生成', () => {
    const match: Match = {
      positions: [{ row: 0, col: 0 }, { row: 1, col: 0 }, { row: 2, col: 0 }, { row: 3, col: 0 }],
      color: 0 as Color,
    };
    expect(determineItem(match)).toBe('h_cut');
  });

  it('5マス直線でflushを生成', () => {
    const match: Match = {
      positions: [
        { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 },
        { row: 0, col: 3 }, { row: 0, col: 4 },
      ],
      color: 0 as Color,
    };
    expect(determineItem(match)).toBe('flush');
  });

  it('5マス非直線でburstを生成', () => {
    const match: Match = {
      positions: [
        { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 },
        { row: 1, col: 0 }, { row: 2, col: 0 },
      ],
      color: 0 as Color,
    };
    expect(determineItem(match)).toBe('burst');
  });
});

describe('determineItemFromMatches - connected groups', () => {
  it('L字型5マス（横3+縦3共有1）でburstを生成', () => {
    // H: (0,0)(0,1)(0,2)  V: (0,2)(1,2)(2,2) → 5 connected non-straight
    const matches: Match[] = [
      { positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }], color: 1 as Color },
      { positions: [{ row: 0, col: 2 }, { row: 1, col: 2 }, { row: 2, col: 2 }], color: 1 as Color },
    ];
    const result = determineItemFromMatches(matches);
    expect(result).not.toBeNull();
    expect(result!.item).toBe('burst');
  });

  it('T字型7マス（横5+縦3共有1）でflushが優先', () => {
    // H5: (0,0)-(0,4) → flush from straight match; also T-shape but flush > burst
    const matches: Match[] = [
      { positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 0, col: 3 }, { row: 0, col: 4 }], color: 2 as Color },
      { positions: [{ row: 0, col: 2 }, { row: 1, col: 2 }, { row: 2, col: 2 }], color: 2 as Color },
    ];
    const result = determineItemFromMatches(matches);
    expect(result).not.toBeNull();
    expect(result!.item).toBe('flush');
  });

  it('同色3+3共有なし（4マス）はburst生成しない', () => {
    // Two separate 3-matches of same color, no overlap → group of 6 but not connected
    const matches: Match[] = [
      { positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }], color: 1 as Color },
      { positions: [{ row: 2, col: 4 }, { row: 2, col: 5 }, { row: 2, col: 6 }], color: 1 as Color },
    ];
    const result = determineItemFromMatches(matches);
    // No individual match ≥ 4, and groups are not connected → no item
    expect(result).toBeNull();
  });

  it('異なる色のマッチは別グループとして扱う', () => {
    const matches: Match[] = [
      { positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }], color: 1 as Color },
      { positions: [{ row: 0, col: 2 }, { row: 1, col: 2 }, { row: 2, col: 2 }], color: 2 as Color },
    ];
    const result = determineItemFromMatches(matches);
    // Different colors, no merging → each is 3-length, no item
    expect(result).toBeNull();
  });

  it('横4マス+縦3マス共有1（6マス）でburstよりv_cutを選択しない（burst優先）', () => {
    // H4: (0,0)-(0,3) → v_cut; but merged group is 6 non-straight → burst (priority 3 > 2)
    const matches: Match[] = [
      { positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 0, col: 3 }], color: 1 as Color },
      { positions: [{ row: 0, col: 2 }, { row: 1, col: 2 }, { row: 2, col: 2 }], color: 1 as Color },
    ];
    const result = determineItemFromMatches(matches);
    expect(result).not.toBeNull();
    expect(result!.item).toBe('burst');
  });
});

describe('determineItemFromMatches - swap position', () => {
  it('swapPositions[0]がマッチに含まれる場合そこにアイテム配置', () => {
    const matches: Match[] = [
      { positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 0, col: 3 }], color: 1 as Color },
    ];
    const origin = { row: 0, col: 1 };
    const target = { row: 1, col: 1 };
    const result = determineItemFromMatches(matches, [origin, target]);
    expect(result).not.toBeNull();
    expect(result!.pos).toEqual(origin);
  });

  it('swapPositions[0]がマッチに含まれない場合swapPositions[1]にフォールバック', () => {
    const matches: Match[] = [
      { positions: [{ row: 2, col: 0 }, { row: 2, col: 1 }, { row: 2, col: 2 }, { row: 2, col: 3 }], color: 1 as Color },
    ];
    // originはマッチに含まれない、targetは含まれる
    const origin = { row: 3, col: 2 };
    const target = { row: 2, col: 2 };
    const result = determineItemFromMatches(matches, [origin, target]);
    expect(result).not.toBeNull();
    expect(result!.pos).toEqual(target);
  });

  it('swapPositionsなしの場合マッチ中央にアイテム配置', () => {
    const matches: Match[] = [
      { positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 0, col: 3 }], color: 1 as Color },
    ];
    const result = determineItemFromMatches(matches);
    expect(result).not.toBeNull();
    expect(result!.pos).toEqual({ row: 0, col: 2 }); // center of sorted positions
  });
});

describe('determineItemFromMatches - 2×2 scope', () => {
  it('2×2マッチのみでscopeを生成', () => {
    const matches: Match[] = [
      {
        positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 }],
        color: 1 as Color,
        shape: '2x2',
      },
    ];
    const result = determineItemFromMatches(matches);
    expect(result).not.toBeNull();
    expect(result!.item).toBe('scope');
  });

  it('2×2 + 3直線の重複ではscopeが成立', () => {
    const matches: Match[] = [
      {
        positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 }],
        color: 1 as Color,
        shape: '2x2',
      },
      {
        positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }],
        color: 1 as Color,
      },
    ];
    const result = determineItemFromMatches(matches);
    expect(result).not.toBeNull();
    expect(result!.item).toBe('scope');
  });

  it('2×2 + 4直線の重複では上位アイテム（v_cut）が優先', () => {
    const matches: Match[] = [
      {
        positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 }],
        color: 1 as Color,
        shape: '2x2',
      },
      {
        positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 0, col: 3 }],
        color: 1 as Color,
      },
    ];
    const result = determineItemFromMatches(matches);
    expect(result).not.toBeNull();
    expect(result!.item).toBe('v_cut');
  });

  it('2×2 + L字5マス以上の重複では上位アイテム（burst）が優先', () => {
    const matches: Match[] = [
      {
        positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 }],
        color: 1 as Color,
        shape: '2x2',
      },
      // L字: 横3 + 縦3 (共有1) = 5マス非直線 → burst
      { positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }], color: 1 as Color },
      { positions: [{ row: 0, col: 2 }, { row: 1, col: 2 }, { row: 2, col: 2 }], color: 1 as Color },
    ];
    const result = determineItemFromMatches(matches);
    expect(result).not.toBeNull();
    expect(result!.item).toBe('burst');
  });
});

describe('Item Synthesis', () => {
  it('v_cut+v_cut → line+line', () => {
    expect(getSynthesisEffect('v_cut', 'v_cut')?.effect).toBe('line+line');
  });

  it('v_cut+h_cut → line+line', () => {
    expect(getSynthesisEffect('v_cut', 'h_cut')?.effect).toBe('line+line');
  });

  it('h_cut+h_cut → line+line', () => {
    expect(getSynthesisEffect('h_cut', 'h_cut')?.effect).toBe('line+line');
  });

  it('v_cut+burst → v_cut+burst', () => {
    expect(getSynthesisEffect('v_cut', 'burst')?.effect).toBe('v_cut+burst');
  });

  it('h_cut+burst → h_cut+burst', () => {
    expect(getSynthesisEffect('h_cut', 'burst')?.effect).toBe('h_cut+burst');
  });

  it('burst+burst → burst+burst', () => {
    expect(getSynthesisEffect('burst', 'burst')?.effect).toBe('burst+burst');
  });

  it('flush+v_cut → flush+v_cut', () => {
    expect(getSynthesisEffect('flush', 'v_cut')?.effect).toBe('flush+v_cut');
  });

  it('flush+flush → flush+flush', () => {
    expect(getSynthesisEffect('flush', 'flush')?.effect).toBe('flush+flush');
  });

  it('scope+scope → scope+scope', () => {
    expect(getSynthesisEffect('scope', 'scope')?.effect).toBe('scope+scope');
  });

  it('scope+v_cut → scope+v_cut', () => {
    expect(getSynthesisEffect('scope', 'v_cut')?.effect).toBe('scope+v_cut');
  });

  it('scope+h_cut → scope+h_cut', () => {
    expect(getSynthesisEffect('scope', 'h_cut')?.effect).toBe('scope+h_cut');
  });

  it('scope+burst → scope+burst', () => {
    expect(getSynthesisEffect('scope', 'burst')?.effect).toBe('scope+burst');
  });

  it('scope+flush → scope+flush', () => {
    expect(getSynthesisEffect('scope', 'flush')?.effect).toBe('scope+flush');
  });
});
