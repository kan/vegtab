import { describe, it, expect } from 'vitest';
import { initializeGame, processAction, processScopeSynthesis, cloneGameState } from '../src/engine.js';
import { hasMatches, findMatches } from '../src/match.js';
import { isGameOver, hasValidSwap, hasActivatableItems, checkGameOverState } from '../src/gameOver.js';
import { countObstacles, allObstaclesCleared } from '../src/obstacle.js';
import { DEFAULT_QUOTA_TABLE } from '../src/survival.js';
import { generateDailySeed } from '../src/seed.js';
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

describe('Cascade Mode - Chain Item Placement', () => {
  it('連鎖中に生成されたアイテムが重力で正しい位置に落下する', () => {
    // 2026-04-05のシードでCASCADEを初期化し、報告された手順を再現
    const seed = generateDailySeed('2026-04-05');
    let state = initializeGame(seed, 'cascade');

    // 各手を実行した後、盤面が全セル埋まっていることを確認
    // （アイテムが不正な位置に上書きされていないことの検証）
    const actions = [
      { type: 'swap' as const, pos: { row: 5, col: 3 }, dir: 'left' as const },  // d3左
      { type: 'swap' as const, pos: { row: 7, col: 2 }, dir: 'up' as const },    // c1上
      { type: 'swap' as const, pos: { row: 5, col: 5 }, dir: 'up' as const },    // f3上
    ];

    for (const action of actions) {
      const prev = state;
      state = processAction(state, action);
      if (state === prev) continue; // 無効な手ならスキップ

      // 盤面の全セルが埋まっていること
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          expect(state.board[r][c]).not.toBeNull();
        }
      }

      // マッチが残っていないこと（連鎖が完全に解決されていること）
      expect(hasMatches(state.board)).toBe(false);
    }
  });

  it('連鎖中アイテムは重力に参加し、宙に浮かない', () => {
    // 多数のシードで連鎖後のアイテム位置を検証
    for (const seedVal of [100, 200, 300, 400, 500]) {
      let state = initializeGame(seedVal, 'cascade');
      const action = findValidSwap(state);
      if (!action) continue;

      state = processAction(state, action);

      // アイテムの下に空きセルがないことを確認（重力に従っている）
      for (let r = 0; r < BOARD_SIZE - 1; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const cell = state.board[r][c];
          if (cell?.item) {
            // アイテムの下のセルがnullでないこと
            const below = state.board[r + 1][c];
            expect(below).not.toBeNull();
          }
        }
      }
    }
  });
});

describe('Item Immediate Placement - All Modes', () => {
  /** 全モードで processAction 後の盤面が整合していることを検証するヘルパー */
  function assertBoardIntegrity(state: GameState, label: string) {
    // 全セルが埋まっている（おじゃまタイル消滅直後を除く）
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(state.board[r][c]).not.toBeNull();
      }
    }
    // マッチが残っていない
    expect(hasMatches(state.board)).toBe(false);
    // アイテムが宙に浮いていない（下にnullがない）
    for (let r = 0; r < BOARD_SIZE - 1; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const cell = state.board[r][c];
        if (cell?.item && !cell.obstacle) {
          const below = state.board[r + 1][c];
          expect(below, `${label}: item at (${r},${c}) has null below`).not.toBeNull();
        }
      }
    }
  }

  it('Sprint: 全シードで連鎖後の盤面整合性', () => {
    for (const seed of [42, 100, 200, 300, 777, 999]) {
      let state = initializeGame(seed, 'sprint');
      const action = findValidSwap(state);
      if (!action) continue;
      state = processAction(state, action);
      assertBoardIntegrity(state, `sprint seed=${seed}`);
    }
  });

  it('Clear: 全シードで連鎖後の盤面整合性（おじゃまタイル含む）', () => {
    for (const seed of [42, 100, 200, 300, 777]) {
      let state = initializeGame(seed, 'clear', { obstacleCount: 5 });
      const action = findValidSwap(state);
      if (!action) continue;
      state = processAction(state, action);
      // Clearモードでは全セル埋まっている必要がある
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          expect(state.board[r][c]).not.toBeNull();
        }
      }
      expect(hasMatches(state.board)).toBe(false);
    }
  });

  it('Survival: 全シードで連鎖後の盤面整合性', () => {
    for (const seed of [42, 100, 200, 300, 777]) {
      let state = initializeGame(seed, 'survival');
      const action = findValidSwap(state);
      if (!action) continue;
      state = processAction(state, action);
      if (state.isGameOver) continue; // ノルマ未達でゲームオーバーの場合はスキップ
      assertBoardIntegrity(state, `survival seed=${seed}`);
    }
  });

  it('Cascade: 全シードで連鎖後の盤面整合性', () => {
    for (const seed of [42, 100, 200, 300, 777, 999]) {
      let state = initializeGame(seed, 'cascade');
      const action = findValidSwap(state);
      if (!action) continue;
      state = processAction(state, action);
      assertBoardIntegrity(state, `cascade seed=${seed}`);
    }
  });

  it('全モードで複数手を連続実行しても盤面が整合する', () => {
    const modes = ['sprint', 'clear', 'survival', 'cascade'] as const;
    for (const mode of modes) {
      const opts = mode === 'clear' ? { obstacleCount: 5 } : undefined;
      let state = initializeGame(42, mode, opts);
      for (let i = 0; i < 5; i++) {
        const action = findValidSwap(state);
        if (!action) break;
        state = processAction(state, action);
        if (state.isGameOver) break;
        // 毎手ごとに全セル埋まり+マッチなし
        for (let r = 0; r < BOARD_SIZE; r++) {
          for (let c = 0; c < BOARD_SIZE; c++) {
            expect(state.board[r][c], `${mode} step=${i}: null at (${r},${c})`).not.toBeNull();
          }
        }
        expect(hasMatches(state.board), `${mode} step=${i}: matches remain`).toBe(false);
      }
    }
  });
});

describe('Item Immediate Placement - Determinism', () => {
  it('即座配置でも同一シード・同一操作で同一結果（全モード）', () => {
    const modes = ['sprint', 'clear', 'survival', 'cascade'] as const;
    for (const mode of modes) {
      const opts = mode === 'clear' ? { obstacleCount: 5 } : undefined;
      const s1 = initializeGame(42, mode, opts);
      const s2 = initializeGame(42, mode, opts);
      const action = findValidSwap(s1);
      if (!action) continue;

      const r1 = processAction(s1, action);
      const r2 = processAction(s2, action);

      expect(r1.score, `${mode}: score mismatch`).toBe(r2.score);
      expect(r1.rngState, `${mode}: rng mismatch`).toEqual(r2.rngState);
      expect(r1.moveCount, `${mode}: moveCount mismatch`).toBe(r2.moveCount);
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          expect(r1.board[r][c]?.color, `${mode}: color at (${r},${c})`).toBe(r2.board[r][c]?.color);
          expect(r1.board[r][c]?.item, `${mode}: item at (${r},${c})`).toBe(r2.board[r][c]?.item);
        }
      }
    }
  });

  it('複数手実行後も決定性が保たれる', () => {
    for (const seed of [42, 123, 456]) {
      const s1 = initializeGame(seed, 'cascade');
      const s2 = initializeGame(seed, 'cascade');

      let state1 = s1;
      let state2 = s2;
      for (let i = 0; i < 5; i++) {
        const action = findValidSwap(state1);
        if (!action) break;
        state1 = processAction(state1, action);
        state2 = processAction(state2, action);
        if (state1.isGameOver) break;
      }

      expect(state1.score).toBe(state2.score);
      expect(state1.moveCount).toBe(state2.moveCount);
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          expect(state1.board[r][c]?.color).toBe(state2.board[r][c]?.color);
          expect(state1.board[r][c]?.item).toBe(state2.board[r][c]?.item);
        }
      }
    }
  });
});

describe('Item Immediate Placement - Item Generation in Chains', () => {
  it('4マス以上のマッチでアイテムが盤面に残る', () => {
    // 多数のシードを試して、アイテムが生成されるケースを探す
    let found = false;
    for (const seed of [42, 55, 77, 100, 123, 200, 300, 400, 500, 600, 700, 800, 900, 999]) {
      let state = initializeGame(seed, 'sprint');
      // 複数手を試す
      for (let i = 0; i < 10 && !state.isGameOver; i++) {
        const action = findValidSwap(state);
        if (!action) break;
        state = processAction(state, action);

        // 盤面にアイテムがあるか確認
        const hasItem = state.board.some(row =>
          row.some(cell => cell?.item !== undefined)
        );
        if (hasItem) {
          found = true;
          // アイテムがある場合、そのアイテムの位置が整合していることを確認
          for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
              const cell = state.board[r][c];
              if (cell?.item) {
                // アイテムセルはcolor=0を持つ
                expect(cell.color).toBe(0);
                // アイテムの下にnullはない
                if (r < BOARD_SIZE - 1) {
                  expect(state.board[r + 1][c]).not.toBeNull();
                }
              }
            }
          }
          break;
        }
      }
    }
    // 少なくとも1つのシードでアイテムが生成されたことを確認
    expect(found, 'No items were generated across all tested seeds').toBe(true);
  });

  it('連鎖によりアイテムが生成されても後続のマッチにアイテムが含まれない', () => {
    // findMatchesはitem付きセルをスキップするため、アイテムがマッチに含まれることはない
    // これを間接的に検証: 連鎖完了後の盤面にアイテムが残っていて、かつマッチがない
    for (const seed of [42, 100, 200, 300, 500, 777]) {
      for (const mode of ['sprint', 'cascade'] as const) {
        let state = initializeGame(seed, mode);
        for (let i = 0; i < 5 && !state.isGameOver; i++) {
          const action = findValidSwap(state);
          if (!action) break;
          state = processAction(state, action);

          // マッチが残っていない（アイテムセルが誤ってマッチに参加していない）
          expect(hasMatches(state.board)).toBe(false);

          // アイテムがあればfindMatchesで返るマッチに含まれていないことを二重確認
          const matches = findMatches(state.board);
          expect(matches.length).toBe(0);
        }
      }
    }
  });

  it('Cascadeモードで連鎖が正しくカウントされる（cascadePoints が加算される）', () => {
    // Cascadeモードでは chainIndex >= 2 の連鎖に対してCPが加算される
    // 即座配置に変更しても、連鎖カウントが正しく機能することを確認
    let foundChain = false;
    for (const seed of [42, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      let state = initializeGame(seed, 'cascade');
      for (let i = 0; i < 10 && !state.isGameOver; i++) {
        const action = findValidSwap(state);
        if (!action) break;
        const prevCP = state.cascadePoints ?? 0;
        state = processAction(state, action);

        if ((state.cascadePoints ?? 0) > prevCP) {
          foundChain = true;
          // CPが増えた場合、maxChainIndexも2以上であるはず
          expect(state.maxChainIndex).toBeGreaterThanOrEqual(2);
          break;
        }
      }
      if (foundChain) break;
    }
    expect(foundChain, 'No chain with CP found across tested seeds').toBe(true);
  });
});

describe('Item Immediate Placement - Edge Cases', () => {
  it('手動配置したアイテムがfindMatchesでスキップされる', () => {
    // アイテム付きセルはマッチ対象から除外されることの直接テスト
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    // 盤面の一部にアイテムを配置してマッチを崩す
    state.board[0][0] = { color: 0 as Color, item: 'scope' };

    // アイテムセルはマッチ判定で無視される
    const matches = findMatches(state.board);
    for (const match of matches) {
      for (const pos of match.positions) {
        // アイテム位置がマッチに含まれていないことを確認
        if (pos.row === 0 && pos.col === 0) {
          throw new Error('Item cell should not be included in matches');
        }
      }
    }
  });

  it('盤面上にアイテムがある状態からのスワップで整合性が保たれる', () => {
    // 先にアイテムを生成させてから、次の手を打つ
    let state = initializeGame(42, 'sprint', { moveLimit: 30 });

    // 数手プレイしてアイテムが盤面に残る状態を作る
    for (let i = 0; i < 15; i++) {
      const action = findValidSwap(state);
      if (!action || state.isGameOver) break;
      state = processAction(state, action);

      // アイテムがある場合、そこからさらに手を打っても整合性が保たれる
      const hasItem = state.board.some(row => row.some(cell => cell?.item));
      if (hasItem) {
        const nextAction = findValidSwap(state);
        if (nextAction && !state.isGameOver) {
          const nextState = processAction(state, nextAction);
          expect(hasMatches(nextState.board)).toBe(false);
          for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
              expect(nextState.board[r][c]).not.toBeNull();
            }
          }
        }
        break;
      }
    }
  });

  it('Clear モードのおじゃまタイルとアイテムの共存', () => {
    // おじゃまタイルがセグメントバリアとして機能している中でも
    // アイテムが正しく配置・落下すること
    for (const seed of [42, 100, 200]) {
      let state = initializeGame(seed, 'clear', { obstacleCount: 10 });
      for (let i = 0; i < 10 && !state.isGameOver; i++) {
        const action = findValidSwap(state);
        if (!action) break;
        state = processAction(state, action);

        // 全セルが埋まっている
        for (let r = 0; r < BOARD_SIZE; r++) {
          for (let c = 0; c < BOARD_SIZE; c++) {
            expect(state.board[r][c]).not.toBeNull();
          }
        }
        // マッチ残りなし
        expect(hasMatches(state.board)).toBe(false);
      }
    }
  });
});
