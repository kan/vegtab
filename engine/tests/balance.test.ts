import { describe, it, expect, beforeAll } from 'vitest';
import { playGame, GameMetrics } from '../src/autoPlayer.js';

const SEEDS = Array.from({ length: 20 }, (_, i) => 1000 + i);

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

describe('Balance', () => {
  let results: GameMetrics[];

  beforeAll(() => {
    results = SEEDS.map(seed => playGame(seed, { obstacleCount: 10 }));
  }, 30_000);

  it('クリア率が10%以上ある', () => {
    const cleared = results.filter(r => r.isCleared).length;
    const clearRate = cleared / results.length;
    logStats('moveCount', results.map(r => r.moveCount));
    logStats('scores', results.map(r => r.finalScore));
    console.log(`clearRate=${(clearRate * 100).toFixed(1)}% (${cleared}/${results.length})`);
    expect(clearRate).toBeGreaterThanOrEqual(0.1);
  });
});
