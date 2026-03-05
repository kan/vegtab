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

describe('determineItemFromMatches - connected groups', () => {
  it('L字型5マス（横3+縦3共有1）でクリップを生成', () => {
    // H: (0,0)(0,1)(0,2)  V: (0,2)(1,2)(2,2) → 5 connected non-straight
    const matches: Match[] = [
      { positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }], color: 1 as Color },
      { positions: [{ row: 0, col: 2 }, { row: 1, col: 2 }, { row: 2, col: 2 }], color: 1 as Color },
    ];
    const result = determineItemFromMatches(matches);
    expect(result).not.toBeNull();
    expect(result!.item).toBe('clip');
  });

  it('T字型7マス（横5+縦3共有1）でコーヒーが優先', () => {
    // H5: (0,0)-(0,4) → coffee from straight match; also T-shape but coffee > clip
    const matches: Match[] = [
      { positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 0, col: 3 }, { row: 0, col: 4 }], color: 2 as Color },
      { positions: [{ row: 0, col: 2 }, { row: 1, col: 2 }, { row: 2, col: 2 }], color: 2 as Color },
    ];
    const result = determineItemFromMatches(matches);
    expect(result).not.toBeNull();
    expect(result!.item).toBe('coffee');
  });

  it('同色3+3共有なし（4マス）はクリップ生成しない', () => {
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

  it('横4マス+縦3マス共有1（6マス）でクリップよりはさみを選択しない（クリップ優先）', () => {
    // H4: (0,0)-(0,3) → scissors; but merged group is 6 non-straight → clip (priority 3 > 2)
    const matches: Match[] = [
      { positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 0, col: 3 }], color: 1 as Color },
      { positions: [{ row: 0, col: 2 }, { row: 1, col: 2 }, { row: 2, col: 2 }], color: 1 as Color },
    ];
    const result = determineItemFromMatches(matches);
    expect(result).not.toBeNull();
    expect(result!.item).toBe('clip');
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

describe('determineItemFromMatches - 2×2 magnifying glass', () => {
  it('2×2マッチのみで虫めがねを生成', () => {
    const matches: Match[] = [
      {
        positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 }],
        color: 1 as Color,
        shape: '2x2',
      },
    ];
    const result = determineItemFromMatches(matches);
    expect(result).not.toBeNull();
    expect(result!.item).toBe('magnifying_glass');
  });

  it('2×2 + 3直線の重複では虫めがねが成立', () => {
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
    expect(result!.item).toBe('magnifying_glass');
  });

  it('2×2 + 4直線の重複では上位アイテム（はさみ）が優先', () => {
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
    expect(result!.item).toBe('scissors');
  });

  it('2×2 + L字5マス以上の重複では上位アイテム（クリップ）が優先', () => {
    const matches: Match[] = [
      {
        positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 }],
        color: 1 as Color,
        shape: '2x2',
      },
      // L字: 横3 + 縦3 (共有1) = 5マス非直線 → clip
      { positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }], color: 1 as Color },
      { positions: [{ row: 0, col: 2 }, { row: 1, col: 2 }, { row: 2, col: 2 }], color: 1 as Color },
    ];
    const result = determineItemFromMatches(matches);
    expect(result).not.toBeNull();
    expect(result!.item).toBe('clip');
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

  it('虫めがね+虫めがね → mag+mag', () => {
    expect(getSynthesisEffect('magnifying_glass', 'magnifying_glass')?.effect).toBe('mag+mag');
  });

  it('虫めがね+はさみ → mag+scissors', () => {
    expect(getSynthesisEffect('magnifying_glass', 'scissors')?.effect).toBe('mag+scissors');
  });

  it('虫めがね+カッター → mag+cutter', () => {
    expect(getSynthesisEffect('magnifying_glass', 'cutter')?.effect).toBe('mag+cutter');
  });

  it('虫めがね+クリップ → mag+clip', () => {
    expect(getSynthesisEffect('magnifying_glass', 'clip')?.effect).toBe('mag+clip');
  });

  it('虫めがね+コーヒー → mag+coffee', () => {
    expect(getSynthesisEffect('magnifying_glass', 'coffee')?.effect).toBe('mag+coffee');
  });
});
