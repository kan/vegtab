import { describe, it, expect } from 'vitest';
import { initializeGame, processAction, cloneGameState } from '../src/engine.js';
import { getFlushTargets } from '../src/item.js';
import { BOARD_SIZE, Cell, Color, GameState } from '../src/types.js';

/**
 * flush (サラダボウル/コーヒーカップ) の連鎖発動テスト
 *
 * burst 等のアイテムが flush を誘爆する際、flush のターゲット色は
 * トリガーアイテムがタイルを消去する *前* の盤面スナップショットから決定される。
 * この修正がなければ flush は消去済みの null 隣接セルしか見えず空振りする。
 */

/** burst+flush の共通シナリオを実行 */
function runBurstFlushScenario(): GameState {
  const state = initializeGame(42, 'sprint', { moveLimit: 30 });
  const cloned = cloneGameState(state);
  cloned.board[3][3] = { color: 0 as Color, item: 'burst' };
  cloned.board[3][5] = { color: 1 as Color, item: 'flush' };
  return processAction(cloned, { type: 'tap', pos: { row: 3, col: 3 } });
}

describe('flush chain-activation (pre-clear snapshot)', () => {
  it('burst が誘爆した flush は消去前の隣接色でターゲットを決定する', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    const cloned = cloneGameState(state);

    // flush の上隣 (2,5) の色を記録 — これが flush のターゲット色になる
    const targetColor = cloned.board[2][5]!.color;
    expect(cloned.board[2][5]!.item).toBeUndefined();

    cloned.board[3][3] = { color: 0 as Color, item: 'burst' };
    cloned.board[3][5] = { color: 1 as Color, item: 'flush' };

    const colorBefore = getFlushTargets(cloned.board, targetColor).length;

    const result = processAction(cloned, { type: 'tap', pos: { row: 3, col: 3 } });

    expect(result).not.toBe(cloned);
    // flush が発動していればスコアは burst 範囲 + targetColor全消しで大きくなる
    // burst 範囲内の非アイテムタイル消去 ≒ 23マス × 10 = 230 点
    // flush 追加消去 ≒ colorBefore × 10 点
    expect(result.score).toBeGreaterThanOrEqual(230 + colorBefore * 10);
  });

  it('flush の全隣接セルが burst 範囲内でも snapshot から色を取得できる', () => {
    const state = initializeGame(99, 'sprint', { moveLimit: 30 });
    const cloned = cloneGameState(state);

    const targetColor = cloned.board[3][5]!.color;
    expect(cloned.board[3][5]!.item).toBeUndefined();

    cloned.board[4][4] = { color: 0 as Color, item: 'burst' };
    cloned.board[4][5] = { color: 1 as Color, item: 'flush' };

    const result = processAction(cloned, { type: 'tap', pos: { row: 4, col: 4 } });

    expect(result).not.toBe(cloned);
    expect(result.score).toBeGreaterThan(230);
  });

  it('flush の隣接に非アイテムセルがない場合は snapshot でも色取得できない', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    const cloned = cloneGameState(state);

    cloned.board[2][2] = { color: 0 as Color, item: 'burst' };
    cloned.board[2][3] = { color: 1 as Color, item: 'flush' };

    // flush(2,3) の 8 隣接を全てアイテム持ちにする
    const neighbors: [number, number][] = [
      [1, 3], [1, 4], [2, 4], [3, 4], [3, 3], [3, 2], [2, 2], [1, 2],
    ];
    for (const [r, c] of neighbors) {
      if (r === 2 && c === 2) continue; // 既に burst
      cloned.board[r][c] = { color: 0 as Color, item: 'h_cut' };
    }

    const result = processAction(cloned, { type: 'tap', pos: { row: 2, col: 2 } });

    expect(result).not.toBe(cloned);
    expect(result.score).toBeGreaterThan(0);
  });

  it('同一セットアップで同一スコア・同一盤面を返す（決定性）', () => {
    const result1 = runBurstFlushScenario();
    const result2 = runBurstFlushScenario();

    expect(result1.score).toBe(result2.score);
    expect(result1.score).toBeGreaterThan(0);

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(result1.board[r][c]).toEqual(result2.board[r][c]);
      }
    }
  });

  it('flush を直接タップした場合も隣接色から正しくターゲットを決定する', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    const cloned = cloneGameState(state);

    const targetColor = cloned.board[3][4]!.color;
    expect(cloned.board[3][4]!.item).toBeUndefined();

    cloned.board[4][4] = { color: 1 as Color, item: 'flush' };

    const colorBefore = getFlushTargets(cloned.board, targetColor).length;

    const result = processAction(cloned, { type: 'tap', pos: { row: 4, col: 4 } });

    expect(result).not.toBe(cloned);
    expect(result.score).toBeGreaterThanOrEqual(colorBefore * 10);
  });
});
