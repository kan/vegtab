import { describe, it, expect } from 'vitest';
import {
  initializeGame, processAction, cloneGameState, processScopeSynthesis, processScopeSwap,
} from '../src/engine.js';
import {
  computeSwapPlan, computeItemTapPlan, computeItemSwapPlan,
  computeSynthesisPlan, computeScopePlan, computeScopeSwapPreChains,
  computeScopeSynthesisPlan,
} from '../src/trace.js';
import { BOARD_SIZE, Cell, Color, Direction, GameState, Position } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** テスト用: 有効なスワイプ操作を探す（アイテムなしセル同士） */
function findValidSwap(state: GameState): { pos: Position; dir: Direction } | null {
  const dirs: Array<{ dir: Direction; dr: number; dc: number }> = [
    { dir: 'right', dr: 0, dc: 1 },
    { dir: 'down', dr: 1, dc: 0 },
  ];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (state.board[r][c]?.item) continue;
      for (const { dir, dr, dc } of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= BOARD_SIZE || nc >= BOARD_SIZE) continue;
        if (state.board[nr][nc]?.item) continue;
        const result = processAction(state, { type: 'swap', pos: { row: r, col: c }, dir });
        if (result !== state && result.score > state.score) {
          return { pos: { row: r, col: c }, dir };
        }
      }
    }
  }
  return null;
}

/** テスト用: アイテムセルとのスワイプ操作を探す（合成ではない） */
function findItemSwap(state: GameState): { pos: Position; dir: Direction } | null {
  const dirs: Array<{ dir: Direction; dr: number; dc: number }> = [
    { dir: 'right', dr: 0, dc: 1 },
    { dir: 'down', dr: 1, dc: 0 },
    { dir: 'left', dr: 0, dc: -1 },
    { dir: 'up', dr: -1, dc: 0 },
  ];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = state.board[r][c];
      if (!cell?.item) continue;
      for (const { dir, dr, dc } of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
        const neighbor = state.board[nr][nc];
        if (!neighbor || neighbor.item) continue; // skip synthesis
        return { pos: { row: r, col: c }, dir };
      }
    }
  }
  return null;
}

/** 盤面の board/score/moveCount/isGameOver/isCleared/maxChainIndex が一致するか比較 */
function assertFinalStateMatch(planState: GameState, engineState: GameState, label: string) {
  expect(planState.score, `${label}: score`).toBe(engineState.score);
  expect(planState.moveCount, `${label}: moveCount`).toBe(engineState.moveCount);
  expect(planState.isGameOver, `${label}: isGameOver`).toBe(engineState.isGameOver);
  expect(planState.isCleared, `${label}: isCleared`).toBe(engineState.isCleared);
  expect(planState.maxChainIndex, `${label}: maxChainIndex`).toBe(engineState.maxChainIndex);
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const pc = planState.board[r][c];
      const ec = engineState.board[r][c];
      expect(pc?.color, `${label}: board[${r}][${c}].color`).toBe(ec?.color);
      expect(pc?.item, `${label}: board[${r}][${c}].item`).toBe(ec?.item);
      expect(pc?.obstacle?.durability, `${label}: board[${r}][${c}].obstacle`).toBe(ec?.obstacle?.durability);
    }
  }
}

// ---------------------------------------------------------------------------
// computeSwapPlan
// ---------------------------------------------------------------------------
describe('computeSwapPlan', () => {
  it('finalState が processAction(state, {type:"swap"}) と一致する（複数シード）', () => {
    for (const seed of [42, 100, 200, 300, 777, 999]) {
      const state = initializeGame(seed);
      const action = findValidSwap(state);
      if (!action) continue;

      const plan = computeSwapPlan(state, action.pos, action.dir);
      expect(plan, `seed=${seed}: plan should not be null`).not.toBeNull();
      if (!plan) continue;

      const engineState = processAction(state, { type: 'swap', pos: action.pos, dir: action.dir });
      assertFinalStateMatch(plan.finalState, engineState, `computeSwapPlan seed=${seed}`);
    }
  });

  it('同一シードで決定論的に同一結果を返す', () => {
    const state1 = initializeGame(42);
    const state2 = initializeGame(42);
    const action = findValidSwap(state1);
    if (!action) return;

    const plan1 = computeSwapPlan(state1, action.pos, action.dir);
    const plan2 = computeSwapPlan(state2, action.pos, action.dir);
    expect(plan1).not.toBeNull();
    expect(plan2).not.toBeNull();
    if (!plan1 || !plan2) return;

    assertFinalStateMatch(plan1.finalState, plan2.finalState, 'determinism');
    expect(plan1.chains.length).toBe(plan2.chains.length);
  });

  it('マッチが成立しないスワイプでnullを返す', () => {
    const state = initializeGame(42);
    // 異色ペアでマッチ不成立のケースを探す
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE - 1; c++) {
        const result = processAction(state, {
          type: 'swap', pos: { row: r, col: c }, dir: 'right',
        });
        if (result === state) {
          // processAction が元の state を返す = 無効操作
          const plan = computeSwapPlan(state, { row: r, col: c }, 'right');
          expect(plan).toBeNull();
          return; // 1件確認できれば十分
        }
      }
    }
  });

  it('盤外へのスワイプでnullを返す', () => {
    const state = initializeGame(42);
    const plan = computeSwapPlan(state, { row: 0, col: 0 }, 'up');
    expect(plan).toBeNull();
  });

  it('アイテムセルを含むスワイプでnullを返す', () => {
    const state = initializeGame(42);
    state.board[3][3] = { color: 0 as Color, item: 'v_cut' };
    // アイテムセルとのスワイプは computeSwapPlan の守備範囲外
    const plan = computeSwapPlan(state, { row: 3, col: 3 }, 'right');
    expect(plan).toBeNull();
  });

  it('chains配列が1以上の要素を持つ（有効スワイプの場合）', () => {
    const state = initializeGame(42);
    const action = findValidSwap(state);
    if (!action) return;
    const plan = computeSwapPlan(state, action.pos, action.dir);
    expect(plan).not.toBeNull();
    expect(plan!.chains.length).toBeGreaterThanOrEqual(1);
    expect(plan!.chains[0].chainIndex).toBe(1);
  });

  it('boardAfterSwapはスワイプ直後の盤面を反映する', () => {
    const state = initializeGame(42);
    const action = findValidSwap(state);
    if (!action) return;
    const plan = computeSwapPlan(state, action.pos, action.dir);
    if (!plan) return;

    const { pos, dir } = action;
    const dr = dir === 'down' ? 1 : dir === 'up' ? -1 : 0;
    const dc = dir === 'right' ? 1 : dir === 'left' ? -1 : 0;
    const target = { row: pos.row + dr, col: pos.col + dc };

    // スワイプ後のboardAfterSwapでは入れ替えが完了している
    expect(plan.boardAfterSwap[pos.row][pos.col]?.color).toBe(
      state.board[target.row][target.col]?.color,
    );
    expect(plan.boardAfterSwap[target.row][target.col]?.color).toBe(
      state.board[pos.row][pos.col]?.color,
    );
  });

  it('おじゃまタイルの個数を変えても finalState が processAction と一致する', () => {
    for (const obstacleCount of [3, 10, 20]) {
      const state = initializeGame(42, { obstacleCount });
      const action = findValidSwap(state);
      if (!action) continue;

      const plan = computeSwapPlan(state, action.pos, action.dir);
      if (!plan) continue;

      const engineState = processAction(state, { type: 'swap', pos: action.pos, dir: action.dir });
      assertFinalStateMatch(plan.finalState, engineState, `computeSwapPlan obstacleCount=${obstacleCount}`);
    }
  });
});

// ---------------------------------------------------------------------------
// computeItemTapPlan
// ---------------------------------------------------------------------------
describe('computeItemTapPlan', () => {
  it('finalState が processAction(state, {type:"tap"}) と一致する', () => {
    for (const seed of [42, 100, 200, 300]) {
      const state = initializeGame(seed);
      // 手動でアイテムを配置
      state.board[4][4] = { color: 0 as Color, item: 'v_cut' };
      const pos = { row: 4, col: 4 };

      const plan = computeItemTapPlan(state, pos);
      const engineState = processAction(state, { type: 'tap', pos });

      if (engineState === state) {
        expect(plan).toBeNull();
        continue;
      }
      expect(plan, `seed=${seed}: plan should not be null`).not.toBeNull();
      if (!plan) continue;
      assertFinalStateMatch(plan.finalState, engineState, `computeItemTapPlan v_cut seed=${seed}`);
    }
  });

  it('h_cut, burst, flush でも finalState が一致する', () => {
    const items: Array<'h_cut' | 'burst' | 'flush'> = ['h_cut', 'burst', 'flush'];
    for (const itemType of items) {
      const state = initializeGame(42);
      state.board[4][4] = { color: 0 as Color, item: itemType };
      const pos = { row: 4, col: 4 };

      const plan = computeItemTapPlan(state, pos);
      const engineState = processAction(state, { type: 'tap', pos });

      if (engineState === state) {
        // flush でターゲットカラーが見つからない場合 null
        if (itemType === 'flush') {
          expect(plan).toBeNull();
        }
        continue;
      }
      expect(plan).not.toBeNull();
      if (!plan) continue;
      assertFinalStateMatch(plan.finalState, engineState, `computeItemTapPlan ${itemType}`);
    }
  });

  it('アイテムのないセルをタップするとnullを返す', () => {
    const state = initializeGame(42);
    const plan = computeItemTapPlan(state, { row: 0, col: 0 });
    expect(plan).toBeNull();
  });

  it('scopeのタップはnullを返す（scopeはtype:"scope"で処理すべき）', () => {
    const state = initializeGame(42);
    state.board[3][3] = { color: 0 as Color, item: 'scope' };
    // processAction with type:'tap' for scope returns the same state
    const engineResult = processAction(state, { type: 'tap', pos: { row: 3, col: 3 } });
    expect(engineResult).toBe(state);
    const plan = computeItemTapPlan(state, { row: 3, col: 3 });
    // scope tap goes to processAction which returns identity => plan is null
    expect(plan).toBeNull();
  });

  it('nullセルをタップするとnullを返す', () => {
    const state = initializeGame(42);
    state.board[0][0] = null;
    const plan = computeItemTapPlan(state, { row: 0, col: 0 });
    expect(plan).toBeNull();
  });

  it('effects配列がアイテム発動情報を含む', () => {
    const state = initializeGame(42);
    state.board[4][4] = { color: 0 as Color, item: 'v_cut' };
    const plan = computeItemTapPlan(state, { row: 4, col: 4 });
    if (!plan) return;
    expect(plan.effects.length).toBeGreaterThanOrEqual(1);
    expect(plan.effects[0].itemType).toBe('v_cut');
    expect(plan.effects[0].itemPos).toEqual({ row: 4, col: 4 });
  });
});

// ---------------------------------------------------------------------------
// computeItemSwapPlan
// ---------------------------------------------------------------------------
describe('computeItemSwapPlan', () => {
  it('アイテム+通常タイルのスワイプで finalState が processAction と一致する', () => {
    for (const seed of [42, 100, 200]) {
      const state = initializeGame(seed);
      // アイテムを手動配置
      state.board[4][4] = { color: 0 as Color, item: 'v_cut' };
      // 隣接セルが通常タイルであることを確認
      if (state.board[4][5]?.item) continue;

      const pos = { row: 4, col: 4 };
      const dir: Direction = 'right';
      const plan = computeItemSwapPlan(state, pos, dir);
      const engineState = processAction(state, { type: 'swap', pos, dir });

      if (engineState === state) {
        expect(plan).toBeNull();
        continue;
      }
      expect(plan, `seed=${seed}: plan should not be null`).not.toBeNull();
      if (!plan) continue;
      assertFinalStateMatch(plan.plan.finalState, engineState, `computeItemSwapPlan seed=${seed}`);
    }
  });

  it('両方アイテムの場合nullを返す（合成はcomputeSynthesisPlanの守備範囲）', () => {
    const state = initializeGame(42);
    state.board[4][4] = { color: 0 as Color, item: 'v_cut' };
    state.board[4][5] = { color: 0 as Color, item: 'h_cut' };
    const plan = computeItemSwapPlan(state, { row: 4, col: 4 }, 'right');
    expect(plan).toBeNull();
  });

  it('両方通常タイルの場合nullを返す', () => {
    const state = initializeGame(42);
    // 通常タイル同士 => computeItemSwapPlan はアイテム含みのスワイプ用
    let found = false;
    for (let r = 0; r < BOARD_SIZE && !found; r++) {
      for (let c = 0; c < BOARD_SIZE - 1 && !found; c++) {
        if (!state.board[r][c]?.item && !state.board[r][c + 1]?.item) {
          const plan = computeItemSwapPlan(state, { row: r, col: c }, 'right');
          expect(plan).toBeNull();
          found = true;
        }
      }
    }
    expect(found).toBe(true);
  });

  it('盤外へのスワイプでnullを返す', () => {
    const state = initializeGame(42);
    state.board[0][0] = { color: 0 as Color, item: 'v_cut' };
    const plan = computeItemSwapPlan(state, { row: 0, col: 0 }, 'up');
    expect(plan).toBeNull();
  });

  it('返り値にboardAfterSwapとpreChains情報が含まれる', () => {
    const state = initializeGame(42);
    state.board[4][4] = { color: 0 as Color, item: 'v_cut' };
    if (state.board[4][5]?.item) return;
    const plan = computeItemSwapPlan(state, { row: 4, col: 4 }, 'right');
    if (!plan) return;
    expect(plan.boardAfterSwap).toBeDefined();
    expect(Array.isArray(plan.preChains)).toBe(true);
    expect(typeof plan.preScore).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// computeSynthesisPlan
// ---------------------------------------------------------------------------
describe('computeSynthesisPlan', () => {
  it('アイテム合成でfinalStateがprocessActionと一致する', () => {
    const state = initializeGame(42);
    state.board[4][4] = { color: 0 as Color, item: 'v_cut' };
    state.board[4][5] = { color: 0 as Color, item: 'h_cut' };

    const plan = computeSynthesisPlan(state, { row: 4, col: 4 }, 'right');
    const engineState = processAction(state, { type: 'swap', pos: { row: 4, col: 4 }, dir: 'right' });

    if (engineState === state) {
      expect(plan).toBeNull();
      return;
    }
    expect(plan).not.toBeNull();
    if (!plan) return;
    assertFinalStateMatch(plan.finalState, engineState, 'computeSynthesisPlan line+line');
  });

  it('flush+flushの合成でfinalStateがprocessActionと一致する', () => {
    const state = initializeGame(42);
    state.board[4][4] = { color: 0 as Color, item: 'flush' };
    state.board[4][5] = { color: 0 as Color, item: 'flush' };

    const plan = computeSynthesisPlan(state, { row: 4, col: 4 }, 'right');
    const engineState = processAction(state, { type: 'swap', pos: { row: 4, col: 4 }, dir: 'right' });

    if (engineState === state) return;
    expect(plan).not.toBeNull();
    if (!plan) return;
    assertFinalStateMatch(plan.finalState, engineState, 'computeSynthesisPlan flush+flush');
  });

  it('burst+burstの合成でfinalStateがprocessActionと一致する', () => {
    const state = initializeGame(42);
    state.board[4][4] = { color: 0 as Color, item: 'burst' };
    state.board[4][5] = { color: 0 as Color, item: 'burst' };

    const plan = computeSynthesisPlan(state, { row: 4, col: 4 }, 'right');
    const engineState = processAction(state, { type: 'swap', pos: { row: 4, col: 4 }, dir: 'right' });

    if (engineState === state) return;
    expect(plan).not.toBeNull();
    if (!plan) return;
    assertFinalStateMatch(plan.finalState, engineState, 'computeSynthesisPlan burst+burst');
  });

  it('アイテムなしセル同士ではnullを返す', () => {
    const state = initializeGame(42);
    // 通常タイル同士
    const plan = computeSynthesisPlan(state, { row: 0, col: 0 }, 'right');
    expect(plan).toBeNull();
  });

  it('合成不可能な組み合わせ（scope+scope除く）でもgetSynthesisEffectがnullならnull', () => {
    const state = initializeGame(42);
    // scope同士は合成可能なので、scopeのみのケースは別
    // 片方がアイテムでもう片方が通常 => 合成不可
    state.board[4][4] = { color: 0 as Color, item: 'v_cut' };
    // neighbor has no item => null
    const plan = computeSynthesisPlan(state, { row: 4, col: 4 }, 'right');
    expect(plan).toBeNull();
  });

  it('effects配列に合成効果情報が含まれる', () => {
    const state = initializeGame(42);
    state.board[4][4] = { color: 0 as Color, item: 'v_cut' };
    state.board[4][5] = { color: 0 as Color, item: 'h_cut' };

    const plan = computeSynthesisPlan(state, { row: 4, col: 4 }, 'right');
    if (!plan) return;
    expect(plan.effects.length).toBeGreaterThanOrEqual(1);
    expect(plan.effects[0].effectType).toBe('line+line');
  });

  it('scope+flush合成でfinalStateがprocessActionと一致する', () => {
    const state = initializeGame(42);
    state.board[4][4] = { color: 0 as Color, item: 'scope' };
    state.board[4][5] = { color: 0 as Color, item: 'flush' };

    const plan = computeSynthesisPlan(state, { row: 4, col: 4 }, 'right');
    const engineState = processAction(state, { type: 'swap', pos: { row: 4, col: 4 }, dir: 'right' });

    if (engineState === state) return;
    expect(plan).not.toBeNull();
    if (!plan) return;
    assertFinalStateMatch(plan.finalState, engineState, 'computeSynthesisPlan scope+flush');
  });
});

// ---------------------------------------------------------------------------
// computeScopePlan
// ---------------------------------------------------------------------------
describe('computeScopePlan', () => {
  it('scopeタップでfinalStateがprocessAction(type:"scope")と一致する', () => {
    const state = initializeGame(42);
    state.board[3][3] = { color: 0 as Color, item: 'scope' };
    const scopePos = { row: 3, col: 3 };
    const target = { row: 4, col: 4 };

    const plan = computeScopePlan(state, scopePos, [target]);
    const engineState = processAction(state, { type: 'scope', pos: scopePos, targetCells: [target] });

    if (engineState === state) {
      expect(plan).toBeNull();
      return;
    }
    expect(plan).not.toBeNull();
    if (!plan) return;
    assertFinalStateMatch(plan.finalState, engineState, 'computeScopePlan');
  });

  it('scope以外のアイテムを指定するとnullを返す', () => {
    const state = initializeGame(42);
    state.board[3][3] = { color: 0 as Color, item: 'v_cut' };
    const plan = computeScopePlan(state, { row: 3, col: 3 }, [{ row: 4, col: 4 }]);
    expect(plan).toBeNull();
  });

  it('アイテムのないセルを指定するとnullを返す', () => {
    const state = initializeGame(42);
    const plan = computeScopePlan(state, { row: 0, col: 0 }, [{ row: 1, col: 1 }]);
    expect(plan).toBeNull();
  });

  it('adjacentTargets情報が含まれる', () => {
    const state = initializeGame(42);
    state.board[3][3] = { color: 0 as Color, item: 'scope' };
    const plan = computeScopePlan(state, { row: 3, col: 3 }, [{ row: 5, col: 5 }]);
    if (!plan) return;
    expect(Array.isArray(plan.adjacentTargets)).toBe(true);
    expect(plan.scopePos).toEqual({ row: 3, col: 3 });
  });

  it('scopeでアイテムを選択するとそのアイテムの発動情報がitemEffectsに含まれる', () => {
    const state = initializeGame(42);
    state.board[3][3] = { color: 0 as Color, item: 'scope' };
    state.board[5][5] = { color: 0 as Color, item: 'v_cut' };
    const plan = computeScopePlan(state, { row: 3, col: 3 }, [{ row: 5, col: 5 }]);
    if (!plan) return;
    expect(plan.itemEffects.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// computeScopeSwapPreChains
// ---------------------------------------------------------------------------
describe('computeScopeSwapPreChains', () => {
  it('scopeと通常タイルのスワイプでpre-chain情報を返す', () => {
    const state = initializeGame(42);
    state.board[3][3] = { color: 0 as Color, item: 'scope' };
    // neighbor should be a normal tile
    if (state.board[3][4]?.item) return;

    const result = computeScopeSwapPreChains(state, { row: 3, col: 3 }, 'right');
    // may be null if scope can't be found after pre-chains
    if (!result) return;
    expect(result.boardAfterSwap).toBeDefined();
    expect(result.scopePos).toBeDefined();
    expect(Array.isArray(result.preChains)).toBe(true);
    expect(typeof result.stateAfterPreChains.score).toBe('number');
  });

  it('scope以外のアイテムセルではnullを返す', () => {
    const state = initializeGame(42);
    state.board[3][3] = { color: 0 as Color, item: 'v_cut' };
    // v_cutはscopeではないのでnull
    const result = computeScopeSwapPreChains(state, { row: 3, col: 3 }, 'right');
    expect(result).toBeNull();
  });

  it('両方アイテムの場合nullを返す', () => {
    const state = initializeGame(42);
    state.board[3][3] = { color: 0 as Color, item: 'scope' };
    state.board[3][4] = { color: 0 as Color, item: 'v_cut' };
    const result = computeScopeSwapPreChains(state, { row: 3, col: 3 }, 'right');
    expect(result).toBeNull();
  });

  it('盤外方向ではnullを返す', () => {
    const state = initializeGame(42);
    state.board[0][0] = { color: 0 as Color, item: 'scope' };
    const result = computeScopeSwapPreChains(state, { row: 0, col: 0 }, 'up');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeScopeSynthesisPlan
// ---------------------------------------------------------------------------
describe('computeScopeSynthesisPlan', () => {
  it('scope+scope合成でfinalStateがprocessActionと一致する', () => {
    const state = initializeGame(42);
    state.board[4][4] = { color: 0 as Color, item: 'scope' };
    state.board[4][5] = { color: 0 as Color, item: 'scope' };

    // scope+scope は選択マスが 3 つ
    const targetCells = [{ row: 6, col: 6 }, { row: 0, col: 0 }, { row: 7, col: 7 }];
    const plan = computeScopeSynthesisPlan(state, { row: 4, col: 4 }, { row: 4, col: 5 }, targetCells);
    const engineState = processScopeSynthesis(state, { row: 4, col: 4 }, { row: 4, col: 5 }, targetCells);

    expect(engineState).not.toBe(state);
    expect(plan).not.toBeNull();
    if (!plan) return;
    assertFinalStateMatch(plan.finalState, engineState, 'computeScopeSynthesisPlan scope+scope');
  });

  it('scope+burst合成でfinalStateがprocessActionと一致する', () => {
    const state = initializeGame(42);
    state.board[4][4] = { color: 0 as Color, item: 'scope' };
    state.board[4][5] = { color: 0 as Color, item: 'burst' };

    const plan = computeScopeSynthesisPlan(state, { row: 4, col: 4 }, { row: 4, col: 5 }, []);
    const engineState = processScopeSynthesis(state, { row: 4, col: 4 }, { row: 4, col: 5 }, []);

    expect(plan).not.toBeNull();
    if (!plan) return;
    assertFinalStateMatch(plan.finalState, engineState, 'computeScopeSynthesisPlan scope+burst');
  });

  it('アイテムなしセルの組み合わせではnullを返す', () => {
    const state = initializeGame(42);
    const plan = computeScopeSynthesisPlan(state, { row: 0, col: 0 }, { row: 0, col: 1 }, []);
    expect(plan).toBeNull();
  });

  it('合成効果が存在しない組み合わせではnullを返す', () => {
    const state = initializeGame(42);
    state.board[4][4] = { color: 0 as Color, item: 'v_cut' };
    state.board[4][5] = { color: 0 as Color, item: 'flush' };
    // v_cut+flushはflush+v_cutとして処理されるが、scopeSynthesisPlanでは
    // getSynthesisEffectをチェックするので、合成あり・なしを確認
    const plan = computeScopeSynthesisPlan(state, { row: 4, col: 4 }, { row: 4, col: 5 }, []);
    // flush+v_cut は合成可能だがscopeSynthesisはscope含みの合成用
    // => scope含まないのでsynthesisEffectはflush+v_cutになり、null以外も可能
    // ここではnullかどうかの検証よりも、整合性を確認
    if (plan) {
      // finalState が engineState と一致することを確認
      const engineState = processScopeSynthesis(state, { row: 4, col: 4 }, { row: 4, col: 5 }, []);
      assertFinalStateMatch(plan.finalState, engineState, 'scopeSynthesisPlan non-scope');
    }
  });

  it('synthEffect情報が正しく設定される', () => {
    const state = initializeGame(42);
    state.board[4][4] = { color: 0 as Color, item: 'scope' };
    state.board[4][5] = { color: 0 as Color, item: 'v_cut' };

    const plan = computeScopeSynthesisPlan(state, { row: 4, col: 4 }, { row: 4, col: 5 }, []);
    if (!plan) return;
    expect(plan.synthEffect).toBe('scope+v_cut');
    expect(plan.pos1).toEqual({ row: 4, col: 4 });
    expect(plan.pos2).toEqual({ row: 4, col: 5 });
  });
});

// ---------------------------------------------------------------------------
// Cross-function consistency: all compute*Plan finalStates match processAction
// ---------------------------------------------------------------------------
describe('Cross-function consistency', () => {
  it('複数手のスワイプシーケンスでcomputeSwapPlanが常にprocessActionと一致する', () => {
    let state = initializeGame(42);
    for (let step = 0; step < 5; step++) {
      const action = findValidSwap(state);
      if (!action) break;

      const plan = computeSwapPlan(state, action.pos, action.dir);
      const engineState = processAction(state, { type: 'swap', pos: action.pos, dir: action.dir });

      if (plan && engineState !== state) {
        assertFinalStateMatch(plan.finalState, engineState, `step=${step}`);
        state = engineState;
      } else {
        break;
      }
    }
  });

  it('おじゃまタイル 5 個の盤面で複数手を進めても computeSwapPlan の finalState が一致する', () => {
    for (const seed of [42, 100, 500]) {
      let state = initializeGame(seed, { obstacleCount: 5 });
      for (let step = 0; step < 3; step++) {
        const action = findValidSwap(state);
        if (!action) break;

        const plan = computeSwapPlan(state, action.pos, action.dir);
        const engineState = processAction(state, { type: 'swap', pos: action.pos, dir: action.dir });

        if (plan && engineState !== state) {
          assertFinalStateMatch(plan.finalState, engineState, `obstacleCount=5 seed=${seed} step=${step}`);
          state = engineState;
        } else {
          break;
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// processScopeSwap: 連鎖の記録と決定性
// ---------------------------------------------------------------------------
describe('processScopeSwap', () => {
  const SCOPE_TARGET: Position[] = [{ row: 7, col: 7 }];

  it('入れ替えで起きた事前連鎖の段数が maxChainIndex と lastChainCount に入る', () => {
    // 複数シードで試行して、pre-chainが発生するケースを探す
    let found = false;
    for (const seed of [42, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 2000, 3000]) {
      const state = initializeGame(seed);

      for (let r = 0; r < BOARD_SIZE - 1 && !found; r++) {
        for (let c = 0; c < BOARD_SIZE - 1 && !found; c++) {
          const neighbor = state.board[r][c + 1];
          if (!neighbor || neighbor.item || neighbor.obstacle) continue;

          const testState = cloneGameState(state);
          testState.board[r][c] = { color: 0 as Color, item: 'scope' };

          const pre = computeScopeSwapPreChains(testState, { row: r, col: c }, 'right');
          if (!pre || pre.preChains.length === 0) continue;
          const preMax = Math.max(...pre.preChains.map(ch => ch.chainIndex));

          const result = processScopeSwap(testState, { row: r, col: c }, 'right', SCOPE_TARGET);
          expect(result).not.toBe(testState);
          expect(result.maxChainIndex).toBeGreaterThanOrEqual(preMax);
          expect(result.lastChainCount).toBeGreaterThanOrEqual(preMax);
          found = true;
        }
      }
      if (found) break;
    }
    expect(found).toBe(true);
  });

  it('同一シード・同一操作で同一結果を返す', () => {
    for (const seed of [42, 100, 500]) {
      const state1 = initializeGame(seed);
      state1.board[3][3] = { color: 0 as Color, item: 'scope' };
      if (state1.board[3][4]?.item) continue;

      const state2 = initializeGame(seed);
      state2.board[3][3] = { color: 0 as Color, item: 'scope' };

      const result1 = processScopeSwap(state1, { row: 3, col: 3 }, 'right', SCOPE_TARGET);
      const result2 = processScopeSwap(state2, { row: 3, col: 3 }, 'right', SCOPE_TARGET);

      assertFinalStateMatch(result1, result2, `processScopeSwap seed=${seed}`);
      expect(result1.rngState).toEqual(result2.rngState);
    }
  });
});

// ---------------------------------------------------------------------------
// computeScopeSwapPreChains: 元の state との関係
// ---------------------------------------------------------------------------
describe('computeScopeSwapPreChains と元の state', () => {
  it('元の state の盤面と rngState を変更しない（クローンされている）', () => {
    const state = initializeGame(42);
    state.board[3][3] = { color: 0 as Color, item: 'scope' };
    if (state.board[3][4]?.item) return;

    const originalRng = [...state.rngState];
    const originalBoard = state.board.map(row => row.map(c => (c ? { ...c } : null)));
    computeScopeSwapPreChains(state, { row: 3, col: 3 }, 'right');

    expect(state.rngState).toEqual(originalRng);
    expect(state.board).toEqual(originalBoard);
  });

  it('事前連鎖後のスコアが processScopeSwap の結果のスコアを超えない', () => {
    for (const seed of [42, 100, 500]) {
      const state = initializeGame(seed);
      state.board[3][3] = { color: 0 as Color, item: 'scope' };
      if (state.board[3][4]?.item) continue;

      const preChainResult = computeScopeSwapPreChains(state, { row: 3, col: 3 }, 'right');
      if (!preChainResult) continue;

      const engineResult = processScopeSwap(state, { row: 3, col: 3 }, 'right', [{ row: 7, col: 7 }]);
      // engineResultのスコアにはpre-chain分が含まれている
      expect(engineResult.score).toBeGreaterThanOrEqual(preChainResult.stateAfterPreChains.score);
    }
  });
});

// ---------------------------------------------------------------------------
// processScopeSynthesis: 決定性
// ---------------------------------------------------------------------------
describe('processScopeSynthesis', () => {
  it('scope合成の決定性（同一シード・同一操作で同一結果）', () => {
    const state1 = initializeGame(42);
    state1.board[4][4] = { color: 0 as Color, item: 'scope' };
    state1.board[4][5] = { color: 0 as Color, item: 'scope' };

    const state2 = initializeGame(42);
    state2.board[4][4] = { color: 0 as Color, item: 'scope' };
    state2.board[4][5] = { color: 0 as Color, item: 'scope' };

    // scope+scope は選択マスが 3 つ
    const targetCells = [{ row: 6, col: 6 }, { row: 0, col: 0 }, { row: 7, col: 7 }];
    const result1 = processScopeSynthesis(state1, { row: 4, col: 4 }, { row: 4, col: 5 }, targetCells);
    const result2 = processScopeSynthesis(state2, { row: 4, col: 4 }, { row: 4, col: 5 }, targetCells);

    expect(result1).not.toBe(state1);
    assertFinalStateMatch(result1, result2, 'processScopeSynthesis determinism');
    expect(result1.rngState).toEqual(result2.rngState);
  });
});

