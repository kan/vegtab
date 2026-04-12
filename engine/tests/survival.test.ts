import { describe, it, expect } from 'vitest';
import {
  SURVIVAL_WAVE_INTERVAL,
  SURVIVAL_WAVE_PREVIEW_LEAD,
  SURVIVAL_WAVE_MAX_OBSTACLES,
  SURVIVAL_MAX_OBSTACLE_DURABILITY,
  currentWaveNumber,
  movesUntilNextWave,
  waveObstacleCount,
  previewWaveNumber,
  computeWavePositions,
  previewWavePositions,
} from '../src/survival.js';

describe('currentWaveNumber', () => {
  it('0手時点ではウェーブ未発生 (0)', () => {
    expect(currentWaveNumber(0)).toBe(0);
  });

  it('INTERVAL の倍数でウェーブ番号が進む', () => {
    const I = SURVIVAL_WAVE_INTERVAL;
    expect(currentWaveNumber(I - 1)).toBe(0);       // 直前はまだウェーブ0
    expect(currentWaveNumber(I)).toBe(1);            // 1倍でウェーブ1
    expect(currentWaveNumber(I * 2 - 1)).toBe(1);   // 次の境界直前
    expect(currentWaveNumber(I * 2)).toBe(2);        // 2倍でウェーブ2
    expect(currentWaveNumber(I * 3)).toBe(3);        // 3倍でウェーブ3
    expect(currentWaveNumber(I * 5)).toBe(5);        // 5倍でウェーブ5
  });
});

describe('movesUntilNextWave', () => {
  it('0手時点では INTERVAL 手で次ウェーブ', () => {
    expect(movesUntilNextWave(0)).toBe(SURVIVAL_WAVE_INTERVAL);
  });

  it('1手経過で残り INTERVAL-1 手', () => {
    expect(movesUntilNextWave(1)).toBe(SURVIVAL_WAVE_INTERVAL - 1);
  });

  it('INTERVAL-1 手経過で残り1手', () => {
    expect(movesUntilNextWave(SURVIVAL_WAVE_INTERVAL - 1)).toBe(1);
  });

  it('INTERVAL 手経過（ちょうどウェーブ発生時）では次まで INTERVAL 手', () => {
    expect(movesUntilNextWave(SURVIVAL_WAVE_INTERVAL)).toBe(SURVIVAL_WAVE_INTERVAL);
  });

  it('任意の N*INTERVAL+k で残り INTERVAL-k 手', () => {
    for (let k = 0; k < SURVIVAL_WAVE_INTERVAL; k++) {
      const moves = SURVIVAL_WAVE_INTERVAL * 3 + k;
      const expected = k === 0 ? SURVIVAL_WAVE_INTERVAL : SURVIVAL_WAVE_INTERVAL - k;
      expect(movesUntilNextWave(moves)).toBe(expected);
    }
  });
});

describe('waveObstacleCount', () => {
  it('ウェーブ0は0個', () => {
    expect(waveObstacleCount(0)).toBe(0);
  });

  it('ウェーブ番号に応じて 8+4n の線形増加', () => {
    // Formula: min(8 + waveNumber * 4, SURVIVAL_WAVE_MAX_OBSTACLES)
    expect(waveObstacleCount(1)).toBe(12);
    expect(waveObstacleCount(2)).toBe(16);
    expect(waveObstacleCount(3)).toBe(SURVIVAL_WAVE_MAX_OBSTACLES); // 20 → 頭打ち
  });

  it('最大値で頭打ちする', () => {
    expect(waveObstacleCount(3)).toBe(SURVIVAL_WAVE_MAX_OBSTACLES);
    expect(waveObstacleCount(10)).toBe(SURVIVAL_WAVE_MAX_OBSTACLES);
    expect(waveObstacleCount(100)).toBe(SURVIVAL_WAVE_MAX_OBSTACLES);
  });
});

describe('previewWaveNumber', () => {
  // 残り (INTERVAL - k) 手 が LEAD 以下になるタイミングで予告開始
  const I = SURVIVAL_WAVE_INTERVAL;
  const LEAD = SURVIVAL_WAVE_PREVIEW_LEAD;

  it('LEADより手前では予告なし（残り LEAD+1 手以上）', () => {
    // moveCount=0 は残り I 手 → I > LEAD の場合予告なし
    if (I > LEAD) {
      expect(previewWaveNumber(0)).toBeNull();
    }
    // ウェーブ1発生直後（moveCount=I）も同様
    if (I > LEAD) {
      expect(previewWaveNumber(I)).toBeNull();
    }
  });

  it('残り LEAD 手以下で次ウェーブの予告表示', () => {
    // ウェーブ1の予告: moveCount = I - LEAD .. I - 1
    for (let k = 1; k <= LEAD; k++) {
      const mc = I - k;
      if (mc >= 0) {
        expect(previewWaveNumber(mc)).toBe(1);
      }
    }
  });

  it('ウェーブ2の予告も同様のタイミングで発動', () => {
    for (let k = 1; k <= LEAD; k++) {
      const mc = I * 2 - k;
      expect(previewWaveNumber(mc)).toBe(2);
    }
  });
});

describe('computeWavePositions - 決定論性', () => {
  it('同一シード・同一ウェーブ番号で常に同じ位置を返す', () => {
    const a = computeWavePositions(12345, 1);
    const b = computeWavePositions(12345, 1);
    expect(a).toEqual(b);
  });

  it('同一シードでもウェーブ番号が違えば異なる結果になり得る', () => {
    const w1 = computeWavePositions(12345, 1);
    const w2 = computeWavePositions(12345, 2);
    // 個数が違うので必ず等しくない
    expect(w1.length).toBe(12);
    expect(w2.length).toBe(16);
  });

  it('異なるシードでは（多くの場合）異なる位置を返す', () => {
    const a = computeWavePositions(12345, 3);
    const b = computeWavePositions(54321, 3);
    // まれに一致することもあるが、個数は同じで内容は異なるはず
    expect(a.length).toBe(b.length);
    const aKey = a.map((p) => `${p.row},${p.col}`).sort().join('|');
    const bKey = b.map((p) => `${p.row},${p.col}`).sort().join('|');
    expect(aKey).not.toBe(bKey);
  });

  it('ウェーブ0では空配列', () => {
    expect(computeWavePositions(1, 0)).toEqual([]);
  });

  it('個数は waveObstacleCount に一致する', () => {
    expect(computeWavePositions(1, 1).length).toBe(12);
    expect(computeWavePositions(1, 2).length).toBe(16);
    expect(computeWavePositions(1, 3).length).toBe(SURVIVAL_WAVE_MAX_OBSTACLES);
    expect(computeWavePositions(1, 10).length).toBe(SURVIVAL_WAVE_MAX_OBSTACLES);
  });

  it('生成された位置はすべて盤面内', () => {
    const positions = computeWavePositions(9999, 5);
    for (const p of positions) {
      expect(p.row).toBeGreaterThanOrEqual(0);
      expect(p.row).toBeLessThan(8);
      expect(p.col).toBeGreaterThanOrEqual(0);
      expect(p.col).toBeLessThan(8);
    }
  });

  it('生成された位置に重複がない', () => {
    const positions = computeWavePositions(777, 5);
    const keys = new Set(positions.map((p) => `${p.row},${p.col}`));
    expect(keys.size).toBe(positions.length);
  });
});

describe('previewWavePositions', () => {
  const I = SURVIVAL_WAVE_INTERVAL;
  const LEAD = SURVIVAL_WAVE_PREVIEW_LEAD;

  it('予告タイミングでなければ null', () => {
    // moveCount=0 は残り I 手。LEAD < I なら予告なし
    if (I > LEAD) {
      expect(previewWavePositions(42, 0)).toBeNull();
    }
    // ちょうどウェーブ発生直後も同様
    if (I > LEAD) {
      expect(previewWavePositions(42, I)).toBeNull();
    }
  });

  it('予告タイミングでは次ウェーブの侵食位置を返す', () => {
    // moveCount = I - 1 は残り1手 → LEAD >= 1 なら予告中
    const mc = I - 1;
    const preview = previewWavePositions(42, mc);
    const actual = computeWavePositions(42, 1);
    expect(preview).toEqual(actual);
  });
});

describe('currentWaveNumber - 境界値', () => {
  it('負数を渡すと0を返す', () => {
    expect(currentWaveNumber(-1)).toBe(0);
    expect(currentWaveNumber(-100)).toBe(0);
  });
});

describe('movesUntilNextWave - 境界値', () => {
  it('大きなmoveCountでも正しく計算される', () => {
    const I = SURVIVAL_WAVE_INTERVAL;
    expect(movesUntilNextWave(I * 100)).toBe(I);
    expect(movesUntilNextWave(I * 100 + 1)).toBe(I - 1);
  });
});

describe('waveObstacleCount - 境界値', () => {
  it('負数を渡すと0を返す', () => {
    expect(waveObstacleCount(-1)).toBe(0);
  });

  it('ウェーブ数が非常に大きくても最大値で頭打ち', () => {
    expect(waveObstacleCount(1000)).toBe(SURVIVAL_WAVE_MAX_OBSTACLES);
  });
});

describe('computeWavePositions - 境界値', () => {
  it('負数のウェーブ番号では空配列を返す', () => {
    expect(computeWavePositions(1, -1)).toEqual([]);
  });

  it('シード0でも正常に動作する', () => {
    const positions = computeWavePositions(0, 1);
    expect(positions.length).toBe(12); // waveObstacleCount(1) = 12
    // 重複がないこと
    const keys = new Set(positions.map(p => `${p.row},${p.col}`));
    expect(keys.size).toBe(positions.length);
  });

  it('非常に大きなシード値でも正常に動作する', () => {
    const positions = computeWavePositions(2147483647, 1);
    expect(positions.length).toBe(12);
    for (const p of positions) {
      expect(p.row).toBeGreaterThanOrEqual(0);
      expect(p.row).toBeLessThan(8);
      expect(p.col).toBeGreaterThanOrEqual(0);
      expect(p.col).toBeLessThan(8);
    }
  });
});

describe('previewWavePositions - 決定論性', () => {
  it('同一シード・同一moveCountで常に同じ結果を返す', () => {
    const I = SURVIVAL_WAVE_INTERVAL;
    const mc = I - 1; // 予告中
    const a = previewWavePositions(42, mc);
    const b = previewWavePositions(42, mc);
    expect(a).toEqual(b);
  });

  it('予告中のウェーブ位置はcomputeWavePositionsの結果と一致する', () => {
    const I = SURVIVAL_WAVE_INTERVAL;
    for (let waveNum = 1; waveNum <= 5; waveNum++) {
      const mc = I * waveNum - 1; // ウェーブ waveNum の予告中
      const preview = previewWavePositions(42, mc);
      const computed = computeWavePositions(42, waveNum);
      expect(preview).toEqual(computed);
    }
  });
});

describe('定数チェック', () => {
  it('SURVIVAL_WAVE_INTERVAL は 3', () => {
    expect(SURVIVAL_WAVE_INTERVAL).toBe(3);
  });

  it('SURVIVAL_WAVE_PREVIEW_LEAD は 2', () => {
    expect(SURVIVAL_WAVE_PREVIEW_LEAD).toBe(2);
  });

  it('SURVIVAL_WAVE_MAX_OBSTACLES は 20', () => {
    expect(SURVIVAL_WAVE_MAX_OBSTACLES).toBe(20);
  });

  it('SURVIVAL_MAX_OBSTACLE_DURABILITY は 4', () => {
    expect(SURVIVAL_MAX_OBSTACLE_DURABILITY).toBe(4);
  });
});
