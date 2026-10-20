import { describe, it, expect } from 'vitest';
import { createColumnRngStates } from '../src/board.js';
import { createRng, nextRng } from '../src/rng.js';
import { initializeGame } from '../src/engine.js';
import { hasMatches } from '../src/match.js';
import { generateDailySeed } from '../src/seed.js';
import { playGame } from '../src/autoPlayer.js';

/**
 * 列ごとのRNGストリームが独立していることを保証する回帰テスト。
 *
 * 以前は createColumnRngStates が nextInt(rng, 0x7fffffff) の戻り値をそのまま
 * 列シードにしていた。この戻り値は raw が正の int32 のとき xorshift の次の状態
 * そのものになるため、8列が「同じストリームを1ステップずつずらしたもの」に
 * なっていた。ある列が隣より1回多く補充された瞬間に両者の状態が一致し、
 * 以後ずっと同じ色を引くため自動消去ループが終わらなくなる。
 */

/** a から k ステップ以内に b へ到達するか（= 実質同一ストリーム）を調べる */
function stepsUntilCollision(a: number, b: number, maxSteps: number): number | null {
  let x = a;
  for (let i = 1; i <= maxSteps; i++) {
    x = nextRng(x)[0];
    if (x === b) return i;
  }
  return null;
}

describe('列RNGの独立性', () => {
  it('列同士のRNG状態が近接しない（同一ストリームの隣接オフセットにならない）', () => {
    const NEAR_STEPS = 64;
    for (let seed = 1; seed <= 300; seed++) {
      const states = createColumnRngStates(createRng(seed));
      for (let i = 0; i < states.length; i++) {
        for (let j = i + 1; j < states.length; j++) {
          expect(stepsUntilCollision(states[i], states[j], NEAR_STEPS)).toBeNull();
          expect(stepsUntilCollision(states[j], states[i], NEAR_STEPS)).toBeNull();
        }
      }
    }
  });

  it('列RNG状態に重複がない', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const states = createColumnRngStates(createRng(seed));
      expect(new Set(states).size).toBe(states.length);
    }
  });

  it('同一シードでは同じ列RNG状態を返す（決定性）', () => {
    expect(createColumnRngStates(createRng(12345)))
      .toEqual(createColumnRngStates(createRng(12345)));
  });
});

describe('初期化が必ず収束する', () => {
  // 修正前に initializeGame が無限ループしていた日付
  const REGRESSION_DATES = ['2026-02-19', '2026-07-26', '2027-01-19', '2027-07-09'];

  for (const date of REGRESSION_DATES) {
    it(`${date} の初期盤面がマッチなしで生成される`, () => {
      const state = initializeGame(generateDailySeed(date));
      expect(hasMatches(state.board)).toBe(false);
    });
  }

  it('連続する日次シードで初期盤面が安定する', () => {
    const start = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 400; i++) {
      const date = new Date(start + i * 86400000).toISOString().slice(0, 10);
      const state = initializeGame(generateDailySeed(date));
      expect(hasMatches(state.board)).toBe(false);
    }
  });

  it('任意シードでも初期盤面が安定する', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      expect(hasMatches(initializeGame(seed).board)).toBe(false);
    }
  });
});

describe('ゲーム進行が必ず終了する', () => {
  // 修正前に連鎖の安定化ループが終わらなくなっていたシード（当時は 78 が Clear、147 が Cascade、981 が Sprint）
  const REGRESSION_SEEDS = [78, 147, 981];

  for (const seed of REGRESSION_SEEDS) {
    it(`seed ${seed} が最後までプレイできる`, () => {
      expect(playGame(seed).moveCount).toBeGreaterThanOrEqual(0);
    });
  }

  // オートプレイ1件あたりが重いため範囲を絞る
  const SWEEP = 100;
  it(`1〜${SWEEP} の全シードで最後までプレイできる`, () => {
    for (let seed = 1; seed <= SWEEP; seed++) {
      expect(playGame(seed).moveCount).toBeGreaterThanOrEqual(0);
    }
  }, 120_000);
});
