import { describe, it, expect } from 'vitest';
import { createRng, nextRng, nextInt } from '../src/rng.js';

describe('RNG', () => {
  it('同一シードで同一の結果を返す（決定性）', () => {
    const s1 = createRng(42);
    const s2 = createRng(42);
    const [next1, val1] = nextRng(s1);
    const [next2, val2] = nextRng(s2);
    expect(next1).toBe(next2);
    expect(val1).toBe(val2);
  });

  it('異なるシードで異なる結果を返す', () => {
    const s1 = createRng(42);
    const s2 = createRng(123);
    const [, val1] = nextRng(s1);
    const [, val2] = nextRng(s2);
    expect(val1).not.toBe(val2);
  });

  it('seed 0 でも動作する', () => {
    const s = createRng(0);
    expect(s).toBe(1);
    const [next] = nextRng(s);
    expect(typeof next).toBe('number');
    expect(next).not.toBe(0);
  });

  it('nextInt が 0以上max未満の値を返す', () => {
    let state = createRng(999);
    for (let i = 0; i < 100; i++) {
      let val: number;
      [state, val] = nextInt(state, 5);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(5);
    }
  });

  it('長い列でも決定的', () => {
    const results1: number[] = [];
    const results2: number[] = [];
    let s1 = createRng(7777);
    let s2 = createRng(7777);
    for (let i = 0; i < 1000; i++) {
      let v: number;
      [s1, v] = nextInt(s1, 100);
      results1.push(v);
      [s2, v] = nextInt(s2, 100);
      results2.push(v);
    }
    expect(results1).toEqual(results2);
  });
});
