import { describe, it, expect, beforeAll } from 'vitest';
import { playGame, GameMetrics } from '../src/autoPlayer.js';

const SEEDS = Array.from({ length: 50 }, (_, i) => 1000 + i);

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    avg: sum / sorted.length,
    median: sorted[Math.floor(sorted.length / 2)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function logStats(label: string, values: number[]) {
  const s = stats(values);
  console.log(`[${label}] avg=${s.avg.toFixed(1)} median=${s.median} min=${s.min} max=${s.max}`);
}

describe('Balance: Sprint mode', () => {
  let results: GameMetrics[];

  beforeAll(() => {
    results = SEEDS.map(seed => playGame(seed, 'sprint'));
  });

  it('全ゲームが手数上限(15)以内で終了する', () => {
    for (const r of results) {
      expect(r.moveCount).toBeLessThanOrEqual(15);
    }
  });

  it('平均スコアが妥当な範囲にある', () => {
    const scores = results.map(r => r.finalScore);
    logStats('Sprint scores', scores);
    const { avg } = stats(scores);
    expect(avg).toBeGreaterThan(100);
    expect(avg).toBeLessThan(10000);
  });

  it('ゼロスコアのゲームが少ない（50中5以下）', () => {
    const zeroCount = results.filter(r => r.finalScore === 0).length;
    expect(zeroCount).toBeLessThanOrEqual(5);
  });
});

describe('Balance: Clear mode', () => {
  const CLEAR_SEEDS = SEEDS.slice(0, 20);
  let results: GameMetrics[];

  beforeAll(() => {
    results = CLEAR_SEEDS.map(seed => playGame(seed, 'clear', { obstacleCount: 10 }));
  }, 30_000);

  it('クリア率が10%以上ある', () => {
    const cleared = results.filter(r => r.isCleared).length;
    const clearRate = cleared / results.length;
    logStats('Clear moveCount', results.map(r => r.moveCount));
    console.log(`[Clear] clearRate=${(clearRate * 100).toFixed(1)}% (${cleared}/${results.length})`);
    expect(clearRate).toBeGreaterThanOrEqual(0.1);
  });
});

describe('Balance: Survival mode', () => {
  let results: GameMetrics[];

  beforeAll(() => {
    results = SEEDS.map(seed => playGame(seed, 'survival'));
  });

  it('平均生存セグメント数が妥当な範囲にある', () => {
    const segments = results.map(r => r.segmentsSurvived!);
    logStats('Survival segments', segments);
    const { avg } = stats(segments);
    expect(avg).toBeGreaterThanOrEqual(1);
    expect(avg).toBeLessThanOrEqual(50);
  });
});

describe('Balance: Cascade mode', () => {
  let results: GameMetrics[];

  beforeAll(() => {
    results = SEEDS.map(seed => playGame(seed, 'cascade'));
  });

  it('全ゲームが15手以内で終了する', () => {
    for (const r of results) {
      expect(r.moveCount).toBeLessThanOrEqual(15);
    }
  });

  it('平均CPが妥当な範囲にある', () => {
    const cps = results.map(r => r.cascadePoints!);
    logStats('Cascade CP', cps);
    const { avg } = stats(cps);
    expect(avg).toBeGreaterThan(5);
    expect(avg).toBeLessThan(200);
  });

  it('平均スコアが妥当な範囲にある', () => {
    const scores = results.map(r => r.finalScore);
    logStats('Cascade scores', scores);
    const { avg } = stats(scores);
    expect(avg).toBeGreaterThan(100);
  });
});
