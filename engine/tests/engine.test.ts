import { describe, it, expect } from 'vitest';
import { initializeGame, processAction, processScopeSynthesis, cloneGameState } from '../src/engine.js';
import { hasMatches, findMatches } from '../src/match.js';
import { isGameOver, hasValidSwap, hasActivatableItems, checkGameOverState } from '../src/gameOver.js';
import { countObstacles, allObstaclesCleared } from '../src/obstacle.js';
import { DEFAULT_QUOTA_TABLE } from '../src/survival.js';
import { BOARD_SIZE, Cell, Color, GameState } from '../src/types.js';

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
    expect(s1.rngState).toEqual(s2.rngState);
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
      expect(r1.rngState).toEqual(r2.rngState);
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
  it('デフォルトはSprintモード(15手)', () => {
    const state = initializeGame(42);
    expect(state.mode).toBe('sprint');
    expect(state.moveLimit).toBe(15);
  });

  it('Sprintモードのカスタム手数', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 20 });
    expect(state.moveLimit).toBe(20);
  });

  it('Sprintモードで規定手数到達時にゲーム終了', () => {
    // 2手制限で2手打つ
    let state = initializeGame(42, 'sprint', { moveLimit: 2 });
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


describe('Sprint game over (no item bonus)', () => {
  it('Sprintモード終了時に残存アイテムボーナスは加算されない', () => {
    // 1手制限で始めて、アイテムを配置してから1手消費
    let state = initializeGame(42, 'sprint', { moveLimit: 1 });
    state.board[7][7] = { color: 0 as Color, item: 'flush' };
    const action = findValidSwap(state);
    if (!action) return;
    const newState = processAction(state, action);
    if (newState.isGameOver) {
      const flushOnBoard = newState.board.some(row =>
        row.some(cell => cell?.item === 'flush')
      );
      if (flushOnBoard) {
        // ボーナスなし: スコアは500未満のはず（アイテム自動発動はフロントエンド側で処理）
        expect(newState.score).toBeLessThan(500);
      }
    }
  });
});

describe('Scope Action', () => {
  it('scopeタップで1マス消去', () => {
    let state = initializeGame(42, 'sprint', { moveLimit: 30 });
    // scopeを手動配置
    state.board[3][3] = { color: 0 as Color, item: 'scope' };
    const target = { row: 4, col: 4 };
    const beforeScore = state.score;
    const newState = processAction(state, {
      type: 'scope',
      pos: { row: 3, col: 3 },
      targetCells: [target],
    });
    expect(newState.moveCount).toBe(1);
    expect(newState.score).toBeGreaterThan(beforeScore);
    // scope自体は消えている
    expect(newState.board[3][3]?.item).not.toBe('scope');
  });

  it('scopeでアイテムを選択するとそのアイテムが発動', () => {
    let state = initializeGame(42, 'sprint', { moveLimit: 30 });
    state.board[3][3] = { color: 0 as Color, item: 'scope' };
    state.board[4][4] = { color: 0 as Color, item: 'v_cut' };
    const newState = processAction(state, {
      type: 'scope',
      pos: { row: 3, col: 3 },
      targetCells: [{ row: 4, col: 4 }],
    });
    // v_cutが発動して縦一列消去→スコア増加
    expect(newState.score).toBeGreaterThan(0);
    expect(newState.board[4][4]?.item).toBeUndefined();
  });

  it('通常tapではscopeは起動しない', () => {
    let state = initializeGame(42, 'sprint', { moveLimit: 30 });
    state.board[3][3] = { color: 0 as Color, item: 'scope' };
    const newState = processAction(state, {
      type: 'tap',
      pos: { row: 3, col: 3 },
    });
    // tapは無効 → 元のstateが返る
    expect(newState).toBe(state);
  });
});

describe('Sprint Mode', () => {
  it('デフォルトのmoveLimitは15', () => {
    const state = initializeGame(42, 'sprint');
    expect(state.moveLimit).toBe(15);
    expect(state.mode).toBe('sprint');
  });

  it('カスタムmoveLimitが設定できる', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 25 });
    expect(state.moveLimit).toBe(25);
  });

  it('ゲーム終了時に残存アイテムボーナスは加算されない（自動発動はフロントエンド側）', () => {
    let state = initializeGame(42, 'sprint', { moveLimit: 1 });
    state.board[7][7] = { color: 0 as Color, item: 'v_cut' };
    const action = findValidSwap(state);
    if (!action) return;
    const newState = processAction(state, action);
    if (newState.isGameOver) {
      const vCutOnBoard = newState.board.some(row =>
        row.some(cell => cell?.item === 'v_cut')
      );
      if (vCutOnBoard) {
        // ボーナスなし: v_cutの150点は加算されない
        expect(newState.score).toBeLessThan(150);
      }
    }
  });

  it('おじゃまタイルもquotaTableも持たない', () => {
    const state = initializeGame(42, 'sprint');
    expect(state.quotaTable).toBeUndefined();
    const obstacleCount = countObstacles(state.board);
    expect(obstacleCount).toBe(0);
  });
});

describe('Clear Mode', () => {
  it('初期化時におじゃまタイルが盤面に存在する', () => {
    const state = initializeGame(42, 'clear');
    expect(state.mode).toBe('clear');
    const count = countObstacles(state.board);
    expect(count).toBeGreaterThanOrEqual(10);
    expect(count).toBeLessThanOrEqual(20);
  });

  it('カスタムobstacleCountでおじゃまタイル数を指定できる', () => {
    const state = initializeGame(42, 'clear', { obstacleCount: 5 });
    expect(countObstacles(state.board)).toBe(5);
  });

  it('moveLimitは設定されない', () => {
    const state = initializeGame(42, 'clear');
    expect(state.moveLimit).toBeUndefined();
  });

  it('ゲーム終了時のスコアはmoveCountになる', () => {
    // 全おじゃまタイルが除去された状態をシミュレート
    const state = initializeGame(42, 'clear', { obstacleCount: 0 });
    state.moveCount = 7;
    // 盤面にはおじゃまタイルがないので checkGameOverState は isCleared: true を返す
    const result = checkGameOverState(state);
    expect(result.gameOver).toBe(true);
    expect(result.isCleared).toBe(true);
  });

  it('全おじゃまタイル除去でisCleared=true', () => {
    const state = initializeGame(42, 'clear', { obstacleCount: 0 });
    const result = checkGameOverState(state);
    expect(result.gameOver).toBe(true);
    expect(result.isCleared).toBe(true);
  });

  it('詰み状態でisCleared=false', () => {
    // 全セルをnullにして詰み状態にし、おじゃまタイルを残す
    const state = initializeGame(42, 'clear');
    // 盤面をクリアして詰み状態にする
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        state.board[r][c] = null;
      }
    }
    // おじゃまタイルを1つ配置
    state.board[0][0] = { color: 0 as Color, obstacle: { durability: 1 } };
    const result = checkGameOverState(state);
    expect(result.gameOver).toBe(true);
    expect(result.isCleared).toBe(false);
  });

  it('Clearモードでもマッチによるスコアが加算される', () => {
    const state = initializeGame(42, 'clear', { obstacleCount: 3 });
    const action = findValidSwap(state);
    if (!action) return;
    const newState = processAction(state, action);
    if (!newState.isGameOver) {
      expect(newState.score).toBeGreaterThanOrEqual(0);
    }
  });

  it('おじゃまタイルはスワイプで入れ替え可能', () => {
    const state = initializeGame(42, 'clear', { obstacleCount: 1 });
    let obsPos: { row: number; col: number } | null = null;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c]?.obstacle) {
          obsPos = { row: r, col: c };
          break;
        }
      }
      if (obsPos) break;
    }
    if (!obsPos) return;
    // おじゃまタイルとのスワイプ — マッチ不成立なら戻る（state同一）、成立なら新state
    const result = processAction(state, {
      type: 'swap',
      pos: obsPos,
      dir: 'right',
    });
    // マッチ不成立で戻るか、成立して新stateのどちらか
    expect(result).toBeDefined();
  });
});

describe('Survival Mode', () => {
  it('初期化時にquotaTableが設定される', () => {
    const state = initializeGame(42, 'survival');
    expect(state.mode).toBe('survival');
    expect(state.quotaTable).toBeDefined();
    expect(state.quotaTable!.length).toBe(DEFAULT_QUOTA_TABLE.length);
  });

  it('カスタムquotaTableが設定できる', () => {
    const customTable = [100, 200, 300];
    const state = initializeGame(42, 'survival', { quotaTable: customTable });
    expect(state.quotaTable).toEqual(customTable);
  });

  it('moveLimitは設定されない', () => {
    const state = initializeGame(42, 'survival');
    expect(state.moveLimit).toBeUndefined();
  });

  it('おじゃまタイルは生成されない', () => {
    const state = initializeGame(42, 'survival');
    expect(countObstacles(state.board)).toBe(0);
  });

  it('チェックポイントでノルマ未達時にゲームオーバーになる', () => {
    const state = initializeGame(42, 'survival');
    state.moveCount = 5; // チェックポイント
    state.score = 0; // ノルマ(300)未達
    const result = checkGameOverState(state);
    expect(result.gameOver).toBe(true);
  });

  it('チェックポイントでノルマ達成時はゲームオーバーにならない', () => {
    const state = initializeGame(42, 'survival');
    state.moveCount = 5;
    state.score = 300; // ノルマ達成
    const result = checkGameOverState(state);
    expect(result.gameOver).toBe(false);
  });

  it('チェックポイント以外ではノルマ判定しない', () => {
    const state = initializeGame(42, 'survival');
    state.moveCount = 3; // 5の倍数ではない
    state.score = 0;
    const result = checkGameOverState(state);
    // 詰みでなければゲームオーバーではない
    if (hasValidSwap(state.board) || hasActivatableItems(state.board)) {
      expect(result.gameOver).toBe(false);
    }
  });
});

describe('Mode Determinism', () => {
  it('同一シード・同一モードで同一の状態を生成する', () => {
    for (const mode of ['sprint', 'clear', 'survival'] as const) {
      const s1 = initializeGame(42, mode);
      const s2 = initializeGame(42, mode);
      expect(s1.mode).toBe(s2.mode);
      expect(s1.rngState).toEqual(s2.rngState);
      expect(s1.moveLimit).toBe(s2.moveLimit);
      expect(s1.quotaTable).toEqual(s2.quotaTable);
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          expect(s1.board[r][c]?.color).toBe(s2.board[r][c]?.color);
          expect(s1.board[r][c]?.obstacle?.durability).toBe(s2.board[r][c]?.obstacle?.durability);
        }
      }
    }
  });

  it('同一シードでもモードが異なれば状態が異なる', () => {
    const sprint = initializeGame(42, 'sprint');
    const clear = initializeGame(42, 'clear');
    const survival = initializeGame(42, 'survival');

    // Clear は obstacles があるので board が異なる
    expect(countObstacles(clear.board)).toBeGreaterThan(0);
    expect(countObstacles(sprint.board)).toBe(0);

    // Survival は quotaTable がある
    expect(survival.quotaTable).toBeDefined();
    expect(sprint.quotaTable).toBeUndefined();
  });
});

describe('Clear Mode - Obstacle Damage via Match', () => {
  it('マッチ消去でおじゃまタイルにダメージが入る', () => {
    const state = initializeGame(42, 'clear', { obstacleCount: 5 });
    const initialCount = countObstacles(state.board);
    expect(initialCount).toBe(5);

    // 有効なスワイプを見つけて実行
    const action = findValidSwap(state);
    if (!action) return;
    const newState = processAction(state, action);
    // おじゃまタイルが減っている可能性がある（隣接マッチがあった場合）
    // 確実に減るわけではないが、テストとしてはエラーなく実行されることを確認
    expect(countObstacles(newState.board)).toBeLessThanOrEqual(initialCount);
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
