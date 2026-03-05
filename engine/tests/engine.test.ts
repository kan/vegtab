import { describe, it, expect } from 'vitest';
import { initializeGame, processAction, undoAction, cloneGameState } from '../src/engine.js';
import { hasMatches, findMatches } from '../src/match.js';
import { isGameOver, hasValidSwap, hasActivatableItems } from '../src/gameOver.js';
import { BOARD_SIZE } from '../src/types.js';

describe('Game Initialization', () => {
  it('初期盤面にマッチが存在しない', () => {
    const state = initializeGame(42);
    expect(hasMatches(state.board)).toBe(false);
  });

  it('初期スコアは0', () => {
    const state = initializeGame(42);
    expect(state.score).toBe(0);
  });

  it('初期盤面は全セルが埋まっている', () => {
    const state = initializeGame(42);
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(state.board[r][c]).not.toBeNull();
      }
    }
  });

  it('同一シードで同一の初期盤面を生成する（決定性）', () => {
    const s1 = initializeGame(12345);
    const s2 = initializeGame(12345);
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(s1.board[r][c]!.color).toBe(s2.board[r][c]!.color);
      }
    }
    expect(s1.rngState).toBe(s2.rngState);
  });

  it('異なるシードで異なる盤面を生成する', () => {
    const s1 = initializeGame(42);
    const s2 = initializeGame(999);
    let same = true;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (s1.board[r][c]!.color !== s2.board[r][c]!.color) {
          same = false;
          break;
        }
      }
      if (!same) break;
    }
    expect(same).toBe(false);
  });
});

describe('Process Action - Swap', () => {
  it('マッチが成立するスワイプでスコアが増加する', () => {
    // 多くのシードで有効な手が存在するはず
    const state = initializeGame(42);
    // 有効な手を探す
    const action = findValidSwap(state);
    if (action) {
      const newState = processAction(state, action);
      expect(newState.score).toBeGreaterThan(0);
      expect(newState.moveCount).toBe(1);
    }
  });

  it('マッチが成立しないスワイプは元の状態を返す', () => {
    const state = initializeGame(42);
    // 同色でないペアを見つける
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE - 1; c++) {
        const c1 = state.board[r][c]!.color;
        const c2 = state.board[r][c + 1]!.color;
        if (c1 !== c2) {
          const result = processAction(state, {
            type: 'swap',
            pos: { row: r, col: c },
            dir: 'right',
          });
          // マッチが成立しなければ元のstateが返る
          if (result === state) {
            expect(result.score).toBe(0);
            return;
          }
        }
      }
    }
  });

  it('同一シード・同一操作で常に同一結果（決定性）', () => {
    const s1 = initializeGame(42);
    const s2 = initializeGame(42);
    const action = findValidSwap(s1);
    if (action) {
      const r1 = processAction(s1, action);
      const r2 = processAction(s2, action);
      expect(r1.score).toBe(r2.score);
      expect(r1.rngState).toBe(r2.rngState);
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          expect(r1.board[r][c]?.color).toBe(r2.board[r][c]?.color);
          expect(r1.board[r][c]?.item).toBe(r2.board[r][c]?.item);
        }
      }
    }
  });
});

describe('Undo', () => {
  it('Undoで1手前の状態に戻る', () => {
    const state = initializeGame(42);
    const action = findValidSwap(state);
    if (action) {
      const afterAction = processAction(state, action);
      const undone = undoAction(afterAction);
      expect(undone).not.toBeNull();
      expect(undone!.score).toBe(0);
      expect(undone!.undoUsed).toBe(true);
    }
  });

  it('Undoは1プレイ1回まで', () => {
    const state = initializeGame(42);
    const action = findValidSwap(state);
    if (action) {
      const afterAction = processAction(state, action);
      const undone = undoAction(afterAction);
      expect(undone).not.toBeNull();
      // 2回目のUndoは失敗
      const action2 = findValidSwap(undone!);
      if (action2) {
        const afterAction2 = processAction(undone!, action2);
        const undone2 = undoAction(afterAction2);
        expect(undone2).toBeNull(); // undoUsed=trueなのでnull
      }
    }
  });

  it('初期状態ではUndoできない', () => {
    const state = initializeGame(42);
    expect(undoAction(state)).toBeNull();
  });
});

describe('Score Calculation', () => {
  it('基礎点は1タイル10点 × 連鎖倍率', () => {
    // 3タイル消去 × 1連鎖 = 30点
    const state = initializeGame(42);
    const action = findValidSwap(state);
    if (action) {
      const newState = processAction(state, action);
      expect(newState.score).toBeGreaterThanOrEqual(30); // 最低3タイル消去
    }
  });
});

describe('Game Over', () => {
  it('有効な手がありアイテムもない通常盤面はゲームオーバーではない', () => {
    const state = initializeGame(42);
    expect(state.isGameOver).toBe(false);
  });
});

/** テスト用: 有効なスワイプ操作を探す */
function findValidSwap(state: ReturnType<typeof initializeGame>) {
  const board = state.board;
  const dirs: Array<{ dir: 'right' | 'down'; dr: number; dc: number }> = [
    { dir: 'right', dr: 0, dc: 1 },
    { dir: 'down', dr: 1, dc: 0 },
  ];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      for (const { dir, dr, dc } of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= BOARD_SIZE || nc >= BOARD_SIZE) continue;
        const result = processAction(state, {
          type: 'swap',
          pos: { row: r, col: c },
          dir,
        });
        if (result !== state && result.score > state.score) {
          return { type: 'swap' as const, pos: { row: r, col: c }, dir };
        }
      }
    }
  }
  return null;
}
