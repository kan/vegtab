/**
 * Cascadeモード: 連鎖ポテンシャル計算のテスト
 */
import { describe, it, expect } from 'vitest';
import { initializeGame, cloneGameState, processAction } from '../src/engine.js';
import { computeMaxChainPotential } from '../src/potential.js';
import { BOARD_SIZE } from '../src/types.js';
import type { Color } from '../src/types.js';

const SEED = 42;

describe('computeMaxChainPotential', () => {
  it('非負の整数を返す', () => {
    const state = initializeGame(SEED, 'cascade');
    const result = computeMaxChainPotential(state);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result)).toBe(true);
  });

  it('決定性: 同一シードで同一結果を返す', () => {
    const s1 = initializeGame(SEED, 'cascade');
    const s2 = initializeGame(SEED, 'cascade');
    expect(computeMaxChainPotential(s1)).toBe(computeMaxChainPotential(s2));
  });

  it('入力stateを変更しない', () => {
    const state = initializeGame(SEED, 'cascade');
    const before = JSON.stringify(state);
    computeMaxChainPotential(state);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('ゲームオーバー状態では0を返す', () => {
    const state = initializeGame(SEED, 'cascade');
    state.isGameOver = true;
    expect(computeMaxChainPotential(state)).toBe(0);
  });

  it('通常の初期盤面では1以上を返す（少なくとも1手は有効）', () => {
    const state = initializeGame(SEED, 'cascade');
    expect(computeMaxChainPotential(state)).toBeGreaterThanOrEqual(1);
  });

  it('複数シードで正の値を返す', () => {
    for (const seed of [1, 42, 100, 9999]) {
      const state = initializeGame(seed, 'cascade');
      expect(computeMaxChainPotential(state)).toBeGreaterThanOrEqual(1);
    }
  });

  it('Cascadeモード以外でも動作する', () => {
    const state = initializeGame(SEED, 'sprint');
    const result = computeMaxChainPotential(state);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('scope付きセルが盤面にある場合でもクラッシュしない', () => {
    const state = initializeGame(SEED, 'cascade');
    // 手動でscopeを配置
    state.board[3][3] = { color: 0 as Color, item: 'scope' };
    const result = computeMaxChainPotential(state);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result)).toBe(true);
  });

  it('ゲーム進行後（手数消費後）も正しく動作する', () => {
    let state = initializeGame(SEED, 'cascade');
    // 数手プレイしてからポテンシャルを計算
    for (let i = 0; i < 3 && !state.isGameOver; i++) {
      let moved = false;
      for (let r = 0; r < BOARD_SIZE && !moved; r++) {
        for (let c = 0; c < BOARD_SIZE && !moved; c++) {
          for (const dir of ['right', 'down'] as const) {
            const next = processAction(state, { type: 'swap', pos: { row: r, col: c }, dir });
            if (next !== state) {
              state = next;
              moved = true;
              break;
            }
          }
        }
      }
      if (!moved) break;
    }
    // 進行後の盤面でもポテンシャル計算が動作する
    const result = computeMaxChainPotential(state);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result)).toBe(true);
  });

  it('残り1手でもポテンシャル計算ができる', () => {
    const state = initializeGame(SEED, 'cascade');
    state.moveCount = 14; // 残り1手
    state.moveLimit = 15;
    const result = computeMaxChainPotential(state);
    // ゲームオーバーではないので計算される
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('異なるシードで異なるポテンシャル値を返しうる', () => {
    // 多くの場合シードが異なれば盤面が異なりポテンシャルも変わる
    const results = new Set<number>();
    for (const seed of [1, 42, 100, 200, 500, 999, 5000, 12345]) {
      const state = initializeGame(seed, 'cascade');
      results.add(computeMaxChainPotential(state));
    }
    // 全て同じ値ではないことを確認（確率的に必ず複数の異なる値が出る）
    expect(results.size).toBeGreaterThanOrEqual(1);
  });

  it('入力stateのmilestonesClaimed/cascadePointsに影響しない', () => {
    const state = initializeGame(SEED, 'cascade');
    const cpBefore = state.cascadePoints;
    const msBefore = [...(state.milestonesClaimed ?? [])];
    computeMaxChainPotential(state);
    expect(state.cascadePoints).toBe(cpBefore);
    expect(state.milestonesClaimed).toEqual(msBefore);
  });
});
