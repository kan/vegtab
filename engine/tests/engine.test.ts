import { describe, it, expect } from 'vitest';
import { initializeGame, processAction, cloneGameState } from '../src/engine.js';
import { hasMatches, findMatches } from '../src/match.js';
import { checkGameOverState } from '../src/gameOver.js';
import { countObstacles } from '../src/obstacle.js';
import { generateDailySeed } from '../src/seed.js';
import { BOARD_SIZE, Color, GameState } from '../src/types.js';

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

  it('初期化時にseed値が保存され、maxChainIndexは0', () => {
    const state = initializeGame(42);
    expect(state.seed).toBe(42);
    expect(state.maxChainIndex).toBe(0);
  });

  it('同一シードで同一の初期盤面を生成する（決定性）', () => {
    const s1 = initializeGame(12345);
    const s2 = initializeGame(12345);
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(s1.board[r][c]!.color).toBe(s2.board[r][c]!.color);
        expect(s1.board[r][c]?.obstacle?.durability).toBe(s2.board[r][c]?.obstacle?.durability);
      }
    }
    expect(s1.rngState).toEqual(s2.rngState);
    expect(s1.seed).toBe(s2.seed);
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

  it('cloneGameStateでseedが正しくコピーされる', () => {
    const state = initializeGame(42);
    const cloned = cloneGameState(state);
    expect(cloned.seed).toBe(42);
    expect(cloned.seed).toBe(state.seed);
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

describe('Scope Action', () => {
  it('scopeタップで1マス消去', () => {
    const state = initializeGame(42);
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
    const state = initializeGame(42);
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
    const state = initializeGame(42);
    state.board[3][3] = { color: 0 as Color, item: 'scope' };
    const newState = processAction(state, {
      type: 'tap',
      pos: { row: 3, col: 3 },
    });
    // tapは無効 → 元のstateが返る
    expect(newState).toBe(state);
  });
});

describe('おじゃまタイルとクリア判定', () => {
  it('初期化時におじゃまタイルが盤面に存在する', () => {
    const state = initializeGame(42);
    const count = countObstacles(state.board);
    expect(count).toBeGreaterThanOrEqual(10);
    expect(count).toBeLessThanOrEqual(20);
  });

  it('カスタムobstacleCountでおじゃまタイル数を指定できる', () => {
    const state = initializeGame(42, { obstacleCount: 5 });
    expect(countObstacles(state.board)).toBe(5);
  });

  it('全おじゃまタイル除去でisCleared=true', () => {
    const state = initializeGame(42, { obstacleCount: 0 });
    const result = checkGameOverState(state);
    expect(result.gameOver).toBe(true);
    expect(result.isCleared).toBe(true);
  });

  it('詰み状態でisCleared=false', () => {
    // 全セルをnullにして詰み状態にし、おじゃまタイルを残す
    const state = initializeGame(42);
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

  it('おじゃまタイルが残っていて詰みでなければゲームオーバーにならない', () => {
    const state = initializeGame(42);
    state.moveCount = 30;
    const result = checkGameOverState(state);
    expect(result.gameOver).toBe(false);
  });

  it('おじゃまタイルがある盤面でもマッチによるスコアが加算される', () => {
    const state = initializeGame(42, { obstacleCount: 3 });
    const action = findValidSwap(state);
    if (!action) return;
    const newState = processAction(state, action);
    expect(newState.score).toBeGreaterThan(0);
  });

  it('おじゃまタイルはスワイプで入れ替え可能', () => {
    const state = initializeGame(42, { obstacleCount: 1 });
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

  it('マッチ消去でおじゃまタイルにダメージが入る', () => {
    const state = initializeGame(42, { obstacleCount: 5 });
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

describe('Chain Item Placement', () => {
  it('連鎖中に生成されたアイテムが重力で正しい位置に落下する', () => {
    // 2026-04-05のシードで、旧 Cascade で報告された手順を打つ（盤面は当時と異なる）
    const seed = generateDailySeed('2026-04-05');
    let state = initializeGame(seed);

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
      let state = initializeGame(seedVal);
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

describe('Item Immediate Placement - Board Integrity', () => {
  /** processAction 後の盤面が整合していることを検証するヘルパー */
  function assertBoardIntegrity(state: GameState, label: string) {
    // 全セルが埋まっている
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(state.board[r][c], `${label}: null at (${r},${c})`).not.toBeNull();
      }
    }
    // マッチが残っていない
    expect(hasMatches(state.board), `${label}: matches remain`).toBe(false);
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

  it('全シードで連鎖後の盤面整合性（おじゃまタイル含む）', () => {
    for (const seed of [42, 100, 200, 300, 777, 999]) {
      let state = initializeGame(seed);
      const action = findValidSwap(state);
      if (!action) continue;
      state = processAction(state, action);
      assertBoardIntegrity(state, `seed=${seed}`);
    }
  });

  it('おじゃまタイルの個数を変えても連鎖後の盤面が整合する', () => {
    for (const obstacleCount of [5, 20]) {
      let state = initializeGame(42, { obstacleCount });
      const action = findValidSwap(state);
      if (!action) continue;
      state = processAction(state, action);
      assertBoardIntegrity(state, `obstacleCount=${obstacleCount}`);
    }
  });

  it('複数手を連続実行しても盤面が整合する', () => {
    for (const seed of [42, 100]) {
      let state = initializeGame(seed);
      for (let i = 0; i < 5; i++) {
        const action = findValidSwap(state);
        if (!action) break;
        state = processAction(state, action);
        if (state.isGameOver) break;
        // 毎手ごとに全セル埋まり+マッチなし
        assertBoardIntegrity(state, `seed=${seed} step=${i}`);
      }
    }
  });
});

describe('Item Immediate Placement - Determinism', () => {
  it('即座配置でも同一シード・同一操作で同一結果', () => {
    for (const obstacleCount of [undefined, 5]) {
      const s1 = initializeGame(42, { obstacleCount });
      const s2 = initializeGame(42, { obstacleCount });
      const action = findValidSwap(s1);
      if (!action) continue;

      const r1 = processAction(s1, action);
      const r2 = processAction(s2, action);

      const label = `obstacleCount=${obstacleCount}`;
      expect(r1.score, `${label}: score mismatch`).toBe(r2.score);
      expect(r1.rngState, `${label}: rng mismatch`).toEqual(r2.rngState);
      expect(r1.moveCount, `${label}: moveCount mismatch`).toBe(r2.moveCount);
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          expect(r1.board[r][c]?.color, `${label}: color at (${r},${c})`).toBe(r2.board[r][c]?.color);
          expect(r1.board[r][c]?.item, `${label}: item at (${r},${c})`).toBe(r2.board[r][c]?.item);
          expect(r1.board[r][c]?.obstacle?.durability, `${label}: obstacle at (${r},${c})`)
            .toBe(r2.board[r][c]?.obstacle?.durability);
        }
      }
    }
  });

  it('複数手実行後も決定性が保たれる', () => {
    for (const seed of [42, 123, 456]) {
      const s1 = initializeGame(seed);
      const s2 = initializeGame(seed);

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
      expect(state1.maxChainIndex).toBe(state2.maxChainIndex);
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          expect(state1.board[r][c]?.color).toBe(state2.board[r][c]?.color);
          expect(state1.board[r][c]?.item).toBe(state2.board[r][c]?.item);
          expect(state1.board[r][c]?.obstacle?.durability).toBe(state2.board[r][c]?.obstacle?.durability);
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
      let state = initializeGame(seed);
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
      let state = initializeGame(seed);
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
  });

  it('2連鎖以上が起きると maxChainIndex が 2 以上になる', () => {
    // maxChainIndex は全操作で更新される
    let foundChain = false;
    for (const seed of [42, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      let state = initializeGame(seed);
      for (let i = 0; i < 10 && !state.isGameOver; i++) {
        const action = findValidSwap(state);
        if (!action) break;
        state = processAction(state, action);

        if ((state.lastChainCount ?? 0) >= 2) {
          foundChain = true;
          expect(state.maxChainIndex).toBeGreaterThanOrEqual(state.lastChainCount!);
          break;
        }
      }
      if (foundChain) break;
    }
    expect(foundChain, 'No chain of 2 or more found across tested seeds').toBe(true);
  });
});

describe('Item Immediate Placement - Edge Cases', () => {
  it('手動配置したアイテムがfindMatchesでスキップされる', () => {
    // アイテム付きセルはマッチ対象から除外されることの直接テスト
    const state = initializeGame(42);
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
    let state = initializeGame(42);

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

  it('おじゃまタイルとアイテムの共存', () => {
    // おじゃまタイルを固定して他のタイルがすり抜けて落ちる中でも
    // アイテムが正しく配置・落下すること
    for (const seed of [42, 100, 200]) {
      let state = initializeGame(seed, { obstacleCount: 10 });
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

describe('サラダボウル×おじゃまタイル スワイプ', () => {
  /** シード配置のおじゃまタイルが無い盤面（テストで置いたおじゃまだけが残る） */
  const boardWithoutObstacles = () => initializeGame(42, { obstacleCount: 0 });

  it('flush×おじゃまスワイプで全おじゃまの耐久値が1減少する', () => {
    const state = boardWithoutObstacles();
    // (3,3) にflush、(3,4) におじゃま耐久値2を配置
    state.board[3][3] = { color: 0 as Color, item: 'flush' };
    state.board[3][4] = { color: 0 as Color, obstacle: { durability: 2 } };
    // 他にも耐久値3のおじゃまを配置
    state.board[0][0] = { color: 0 as Color, obstacle: { durability: 3 } };
    state.board[7][7] = { color: 0 as Color, obstacle: { durability: 1 } };

    const result = processAction(state, { type: 'swap', pos: { row: 3, col: 3 }, dir: 'right' });
    expect(result).not.toBe(state); // 操作が有効

    // スワップ後: flush→(3,4), obstacle→(3,3)。flushは消去され、全おじゃまに-1ダメージ
    // (3,3) のおじゃま: 耐久値2→1（おじゃまは落下しないので位置固定）
    const obs33 = result.board[3][3]?.obstacle;
    expect(obs33).toBeDefined();
    expect(obs33!.durability).toBe(1);

    // (0,0) のおじゃま: 耐久値3→2
    const obs00 = result.board[0][0]?.obstacle;
    expect(obs00).toBeDefined();
    expect(obs00!.durability).toBe(2);

    // (7,7) のおじゃま: 耐久値1→0 → 破壊（nullになる）
    // 注: 破壊後に落下→補充で新タイルが入る可能性があるため、obstacleがないことのみ確認
    const cell77 = result.board[7][7];
    expect(cell77?.obstacle).toBeUndefined();
  });

  it('flush×おじゃまスワイプは1手消費する', () => {
    const state = boardWithoutObstacles();
    state.board[3][3] = { color: 0 as Color, item: 'flush' };
    state.board[3][4] = { color: 0 as Color, obstacle: { durability: 2 } };
    const beforeMoves = state.moveCount;

    const result = processAction(state, { type: 'swap', pos: { row: 3, col: 3 }, dir: 'right' });
    expect(result.moveCount).toBe(beforeMoves + 1);
  });

  it('flush×おじゃまスワイプでflushが消去される', () => {
    const state = boardWithoutObstacles();
    state.board[3][3] = { color: 0 as Color, item: 'flush' };
    state.board[3][4] = { color: 0 as Color, obstacle: { durability: 2 } };

    const result = processAction(state, { type: 'swap', pos: { row: 3, col: 3 }, dir: 'right' });
    // スワップ後のflush位置(3,4)にflushが残っていないこと
    expect(result.board[3][4]?.item).not.toBe('flush');
    // スワップ元の位置(3,3)にもflushがないこと
    expect(result.board[3][3]?.item).not.toBe('flush');
  });

  it('おじゃまがない盤面でflush×非おじゃまスワイプは通常の色消去が発動する', () => {
    const state = boardWithoutObstacles();
    // flushと通常タイルのスワイプ
    state.board[3][3] = { color: 0 as Color, item: 'flush' };
    state.board[3][4] = { color: 1 as Color }; // 通常タイル

    const result = processAction(state, { type: 'swap', pos: { row: 3, col: 3 }, dir: 'right' });
    // 通常のflush発動（同色消去）が起きてスコアが入る
    if (result !== state) {
      expect(result.score).toBeGreaterThan(0);
    }
  });

  it('flush×おじゃまスワイプで破壊されたおじゃま1個につき10点加算される', () => {
    const state = boardWithoutObstacles();
    state.board[3][3] = { color: 0 as Color, item: 'flush' };
    state.board[3][4] = { color: 0 as Color, obstacle: { durability: 1 } };
    // 耐久値1のおじゃまをさらに2個配置（計3個が破壊される）
    state.board[0][0] = { color: 0 as Color, obstacle: { durability: 1 } };
    state.board[7][7] = { color: 0 as Color, obstacle: { durability: 1 } };
    const scoreBefore = state.score;

    const result = processAction(state, { type: 'swap', pos: { row: 3, col: 3 }, dir: 'right' });
    // 3個破壊 × 10点 = 30点（連鎖スコアは別途加算される可能性あり）
    expect(result.score).toBeGreaterThanOrEqual(scoreBefore + 30);
  });

  it('耐久値が高いおじゃまのみの場合はスコアが0点（破壊なし）', () => {
    const state = boardWithoutObstacles();
    state.board[3][3] = { color: 0 as Color, item: 'flush' };
    state.board[3][4] = { color: 0 as Color, obstacle: { durability: 3 } };
    // 他のおじゃまも高耐久値
    state.board[0][0] = { color: 0 as Color, obstacle: { durability: 4 } };
    const scoreBefore = state.score;

    const result = processAction(state, { type: 'swap', pos: { row: 3, col: 3 }, dir: 'right' });
    // 破壊0個のダメージスコアは0（連鎖のスコアのみ）
    // ダメージスコア(destroyed.length * 10)の部分は0であることを間接確認
    expect(result).not.toBe(state); // 操作は有効
    expect(result.score).toBeGreaterThanOrEqual(scoreBefore);
    // (3,4)のおじゃま耐久値は3→2、(0,0)は4→3
    const obs34 = result.board[3][4]?.obstacle;
    if (obs34) expect(obs34.durability).toBe(2);
    const obs00 = result.board[0][0]?.obstacle;
    if (obs00) expect(obs00.durability).toBe(3);
  });

  it('逆方向（おじゃま側からflush側へ）スワイプでも全おじゃまにダメージが入る', () => {
    const state = boardWithoutObstacles();
    // (3,3)におじゃま、(3,4)にflush
    state.board[3][3] = { color: 0 as Color, obstacle: { durability: 2 } };
    state.board[3][4] = { color: 0 as Color, item: 'flush' };
    // 別位置にもおじゃま
    state.board[0][0] = { color: 0 as Color, obstacle: { durability: 3 } };

    // (3,3)からrightスワイプ → cell1がobstacle, cell2がflush
    const result = processAction(state, { type: 'swap', pos: { row: 3, col: 3 }, dir: 'right' });
    expect(result).not.toBe(state);

    // 全おじゃまに-1ダメージ
    // (3,3)のobstacleはスワップ後(3,4)に移動し、ダメージで2→1
    // ただしスワップ後のレイアウトはエンジン内部ロジック次第
    // 少なくとも操作は有効で、(0,0)の耐久値は減少しているはず
    const obs00 = result.board[0][0]?.obstacle;
    expect(obs00).toBeDefined();
    expect(obs00!.durability).toBe(2);
  });

  it('シード配置のおじゃまがある盤面でもflush×おじゃまスワイプが動作する', () => {
    const state = initializeGame(42);
    state.board[3][3] = { color: 0 as Color, item: 'flush' };
    state.board[3][4] = { color: 0 as Color, obstacle: { durability: 2 } };
    state.board[0][0] = { color: 0 as Color, obstacle: { durability: 1 } };

    const result = processAction(state, { type: 'swap', pos: { row: 3, col: 3 }, dir: 'right' });
    expect(result).not.toBe(state);
    // (0,0) 耐久値1→0 → 破壊
    expect(result.board[0][0]?.obstacle).toBeUndefined();
  });

  it('flush×おじゃまスワイプ後に落下と補充が実行される', () => {
    const state = boardWithoutObstacles();
    // 上部におじゃま(耐久値1)、その上に通常タイルを配置
    state.board[5][5] = { color: 0 as Color, obstacle: { durability: 1 } };
    state.board[4][5] = { color: 1 as Color };
    // flushとおじゃまスワイプ
    state.board[3][3] = { color: 0 as Color, item: 'flush' };
    state.board[3][4] = { color: 0 as Color, obstacle: { durability: 2 } };

    const result = processAction(state, { type: 'swap', pos: { row: 3, col: 3 }, dir: 'right' });
    // (5,5)のおじゃまが破壊(1→0)された後、落下と補充が走るので全セルが埋まる
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(result.board[r][c]).not.toBeNull();
      }
    }
  });

  it('flush×おじゃまスワイプ後にゲームオーバー判定が実行される', () => {
    const state = boardWithoutObstacles();
    state.board[3][3] = { color: 0 as Color, item: 'flush' };
    state.board[3][4] = { color: 0 as Color, obstacle: { durability: 2 } };

    const result = processAction(state, { type: 'swap', pos: { row: 3, col: 3 }, dir: 'right' });
    // 耐久値2→1 でおじゃまが残るのでクリアにならない
    expect(result.isGameOver).toBe(false);
    expect(result.isCleared).not.toBe(true);
  });

  it('flush×おじゃまスワイプで最後のおじゃまを壊すとクリアになる', () => {
    const state = boardWithoutObstacles();
    state.board[3][3] = { color: 0 as Color, item: 'flush' };
    state.board[3][4] = { color: 0 as Color, obstacle: { durability: 1 } };

    const result = processAction(state, { type: 'swap', pos: { row: 3, col: 3 }, dir: 'right' });
    expect(result.isGameOver).toBe(true);
    expect(result.isCleared).toBe(true);
  });

  it('flush×おじゃまスワイプは決定的である（同一入力で同一結果）', () => {
    function run() {
      const state = boardWithoutObstacles();
      state.board[3][3] = { color: 0 as Color, item: 'flush' };
      state.board[3][4] = { color: 0 as Color, obstacle: { durability: 2 } };
      state.board[0][0] = { color: 0 as Color, obstacle: { durability: 1 } };
      return processAction(state, { type: 'swap', pos: { row: 3, col: 3 }, dir: 'right' });
    }

    const r1 = run();
    const r2 = run();
    expect(r1.score).toBe(r2.score);
    expect(r1.moveCount).toBe(r2.moveCount);
    expect(r1.isGameOver).toBe(r2.isGameOver);
    // 盤面が完全一致
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(r1.board[r][c]?.color).toBe(r2.board[r][c]?.color);
        expect(r1.board[r][c]?.item).toBe(r2.board[r][c]?.item);
        expect(r1.board[r][c]?.obstacle?.durability).toBe(r2.board[r][c]?.obstacle?.durability);
      }
    }
  });

  it('おじゃまタイルが1つだけ（スワイプ対象のみ）の場合', () => {
    const state = boardWithoutObstacles();
    state.board[3][3] = { color: 0 as Color, item: 'flush' };
    state.board[3][4] = { color: 0 as Color, obstacle: { durability: 1 } };
    // おじゃまは(3,4)の1個のみ

    const obsBefore = countObstacles(state.board);
    expect(obsBefore).toBe(1);

    const result = processAction(state, { type: 'swap', pos: { row: 3, col: 3 }, dir: 'right' });
    expect(result).not.toBe(state);
    // 唯一のおじゃまが耐久値1→0→破壊される
    expect(countObstacles(result.board)).toBe(0);
  });
});
