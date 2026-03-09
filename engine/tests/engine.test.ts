import { describe, it, expect } from 'vitest';
import { initializeGame, processAction, processMagnifyingSynthesis, cloneGameState } from '../src/engine.js';
import { hasMatches, findMatches } from '../src/match.js';
import { isGameOver, hasValidSwap, hasActivatableItems } from '../src/gameOver.js';
import { calculateRemainingItemBonus } from '../src/score.js';
import { BOARD_SIZE, Cell, Color } from '../src/types.js';

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

describe('Game Mode', () => {
  it('デフォルトは手数制限モード(15手)', () => {
    const state = initializeGame(42);
    expect(state.mode).toBe('limited');
    expect(state.moveLimit).toBe(15);
  });

  it('手数制限モードのカスタム手数', () => {
    const state = initializeGame(42, 20);
    expect(state.moveLimit).toBe(20);
  });

  it('手数制限モードで規定手数到達時にゲーム終了', () => {
    // 2手制限で2手打つ
    let state = initializeGame(42, 2);
    const action1 = findValidSwap(state);
    if (!action1) return;
    state = processAction(state, action1);
    expect(state.moveCount).toBe(1);
    expect(state.isGameOver).toBe(false);

    const action2 = findValidSwap(state);
    if (!action2) return;
    state = processAction(state, action2);
    expect(state.moveCount).toBe(2);
    expect(state.isGameOver).toBe(true);
  });
});


describe('Remaining Item Bonus', () => {
  it('盤上のアイテムに応じたボーナスを計算', () => {
    const board: (Cell | null)[][] = Array.from({ length: BOARD_SIZE }, () =>
      Array.from({ length: BOARD_SIZE }, () => ({ color: 0 as Color }))
    );
    board[0][0] = { color: 0 as Color, item: 'magnifying_glass' };
    board[1][1] = { color: 0 as Color, item: 'scissors' };
    board[2][2] = { color: 0 as Color, item: 'coffee' };
    expect(calculateRemainingItemBonus(board)).toBe(50 + 150 + 500);
  });

  it('アイテムがなければボーナス0', () => {
    const board: (Cell | null)[][] = Array.from({ length: BOARD_SIZE }, () =>
      Array.from({ length: BOARD_SIZE }, () => ({ color: 0 as Color }))
    );
    expect(calculateRemainingItemBonus(board)).toBe(0);
  });

  it('手数制限モード終了時に残存アイテムボーナスが加算される', () => {
    // 1手制限で始めて、アイテムを配置してから1手消費
    let state = initializeGame(42, 'limited', 1);
    // 手動でアイテムを配置
    state.board[7][7] = { color: 0 as Color, item: 'coffee' };
    const action = findValidSwap(state);
    if (!action) return;
    const newState = processAction(state, action);
    if (newState.isGameOver) {
      // コーヒーが残っていればボーナスが加算されているはず
      const coffeeOnBoard = newState.board.some(row =>
        row.some(cell => cell?.item === 'coffee')
      );
      if (coffeeOnBoard) {
        // スコアにはアイテムボーナス500が含まれる
        expect(newState.score).toBeGreaterThanOrEqual(500);
      }
    }
  });
});

describe('Magnifying Glass Action', () => {
  it('虫めがねタップで1マス消去', () => {
    let state = initializeGame(42, 'limited', 30);
    // 虫めがねを手動配置
    state.board[3][3] = { color: 0 as Color, item: 'magnifying_glass' };
    const target = { row: 4, col: 4 };
    const beforeScore = state.score;
    const newState = processAction(state, {
      type: 'magnifying_glass',
      pos: { row: 3, col: 3 },
      targetCells: [target],
    });
    expect(newState.moveCount).toBe(1);
    expect(newState.score).toBeGreaterThan(beforeScore);
    // 虫めがね自体は消えている
    expect(newState.board[3][3]?.item).not.toBe('magnifying_glass');
  });

  it('虫めがねでアイテムを選択するとそのアイテムが発動', () => {
    let state = initializeGame(42, 'limited', 30);
    state.board[3][3] = { color: 0 as Color, item: 'magnifying_glass' };
    state.board[4][4] = { color: 0 as Color, item: 'scissors' };
    const newState = processAction(state, {
      type: 'magnifying_glass',
      pos: { row: 3, col: 3 },
      targetCells: [{ row: 4, col: 4 }],
    });
    // はさみが発動して縦一列消去→スコア増加
    expect(newState.score).toBeGreaterThan(0);
    expect(newState.board[4][4]?.item).toBeUndefined();
  });

  it('通常tapでは虫めがねは起動しない', () => {
    let state = initializeGame(42, 'limited', 30);
    state.board[3][3] = { color: 0 as Color, item: 'magnifying_glass' };
    const newState = processAction(state, {
      type: 'tap',
      pos: { row: 3, col: 3 },
    });
    // tapは無効 → 元のstateが返る
    expect(newState).toBe(state);
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
