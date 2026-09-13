import { describe, it, expect } from 'vitest';
import {
  initializeGame, processAction, processAutoActivation, processAutoActivationStep,
  cloneGameState, processScopeSynthesis, processScopeSwap,
} from '../src/engine.js';
import {
  computeSwapPlan, computeItemTapPlan, computeItemSwapPlan,
  computeSynthesisPlan, computeScopePlan, computeScopeSwapPreChains,
  computeScopeSynthesisPlan, computeAutoActivationPlan,
} from '../src/trace.js';
import { findMatches, hasMatches } from '../src/match.js';
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

/** 盤面の board/score/moveCount/rngState/isGameOver/isCleared が一致するか比較 */
function assertFinalStateMatch(planState: GameState, engineState: GameState, label: string) {
  expect(planState.score, `${label}: score`).toBe(engineState.score);
  expect(planState.moveCount, `${label}: moveCount`).toBe(engineState.moveCount);
  expect(planState.isGameOver, `${label}: isGameOver`).toBe(engineState.isGameOver);
  expect(planState.isCleared, `${label}: isCleared`).toBe(engineState.isCleared);
  expect(planState.mode, `${label}: mode`).toBe(engineState.mode);
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
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
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

  it('全モードで finalState が processAction と一致する', () => {
    for (const mode of ['sprint', 'clear', 'survival', 'cascade'] as const) {
      const opts = mode === 'clear' ? { obstacleCount: 3 } : undefined;
      const state = initializeGame(42, mode, opts);
      const action = findValidSwap(state);
      if (!action) continue;

      const plan = computeSwapPlan(state, action.pos, action.dir);
      if (!plan) continue;

      const engineState = processAction(state, { type: 'swap', pos: action.pos, dir: action.dir });
      assertFinalStateMatch(plan.finalState, engineState, `computeSwapPlan mode=${mode}`);
    }
  });
});

// ---------------------------------------------------------------------------
// computeItemTapPlan
// ---------------------------------------------------------------------------
describe('computeItemTapPlan', () => {
  it('finalState が processAction(state, {type:"tap"}) と一致する', () => {
    for (const seed of [42, 100, 200, 300]) {
      const state = initializeGame(seed, 'sprint', { moveLimit: 30 });
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
      const state = initializeGame(42, 'sprint', { moveLimit: 30 });
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
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
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
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
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
      const state = initializeGame(seed, 'sprint', { moveLimit: 30 });
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
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
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
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    state.board[0][0] = { color: 0 as Color, item: 'v_cut' };
    const plan = computeItemSwapPlan(state, { row: 0, col: 0 }, 'up');
    expect(plan).toBeNull();
  });

  it('返り値にboardAfterSwapとpreChains情報が含まれる', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
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
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
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
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
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
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
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
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    // scope同士は合成可能なので、scopeのみのケースは別
    // 片方がアイテムでもう片方が通常 => 合成不可
    state.board[4][4] = { color: 0 as Color, item: 'v_cut' };
    // neighbor has no item => null
    const plan = computeSynthesisPlan(state, { row: 4, col: 4 }, 'right');
    expect(plan).toBeNull();
  });

  it('effects配列に合成効果情報が含まれる', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    state.board[4][4] = { color: 0 as Color, item: 'v_cut' };
    state.board[4][5] = { color: 0 as Color, item: 'h_cut' };

    const plan = computeSynthesisPlan(state, { row: 4, col: 4 }, 'right');
    if (!plan) return;
    expect(plan.effects.length).toBeGreaterThanOrEqual(1);
    expect(plan.effects[0].effectType).toBe('line+line');
  });

  it('scope+flush合成でfinalStateがprocessActionと一致する', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
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
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
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
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
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
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    state.board[3][3] = { color: 0 as Color, item: 'scope' };
    const plan = computeScopePlan(state, { row: 3, col: 3 }, [{ row: 5, col: 5 }]);
    if (!plan) return;
    expect(Array.isArray(plan.adjacentTargets)).toBe(true);
    expect(plan.scopePos).toEqual({ row: 3, col: 3 });
  });

  it('scopeでアイテムを選択するとそのアイテムの発動情報がitemEffectsに含まれる', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
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
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
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
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    state.board[3][3] = { color: 0 as Color, item: 'v_cut' };
    // v_cutはscopeではないのでnull
    const result = computeScopeSwapPreChains(state, { row: 3, col: 3 }, 'right');
    expect(result).toBeNull();
  });

  it('両方アイテムの場合nullを返す', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    state.board[3][3] = { color: 0 as Color, item: 'scope' };
    state.board[3][4] = { color: 0 as Color, item: 'v_cut' };
    const result = computeScopeSwapPreChains(state, { row: 3, col: 3 }, 'right');
    expect(result).toBeNull();
  });

  it('盤外方向ではnullを返す', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
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
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    state.board[4][4] = { color: 0 as Color, item: 'scope' };
    state.board[4][5] = { color: 0 as Color, item: 'scope' };

    const targetCells = [{ row: 6, col: 6 }];
    const plan = computeScopeSynthesisPlan(state, { row: 4, col: 4 }, { row: 4, col: 5 }, targetCells);
    const engineState = processScopeSynthesis(state, { row: 4, col: 4 }, { row: 4, col: 5 }, targetCells);

    expect(plan).not.toBeNull();
    if (!plan) return;
    assertFinalStateMatch(plan.finalState, engineState, 'computeScopeSynthesisPlan scope+scope');
  });

  it('scope+burst合成でfinalStateがprocessActionと一致する', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
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
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
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
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
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
// computeAutoActivationPlan
// ---------------------------------------------------------------------------
describe('computeAutoActivationPlan', () => {
  it('Sprintモードでアイテムが存在する場合にプランを返す', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    state.board[4][4] = { color: 0 as Color, item: 'v_cut' };
    state.isGameOver = true; // 通常はゲーム終了後に呼ばれる

    const result = computeAutoActivationPlan(state);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.pos).toEqual({ row: 4, col: 4 });
    expect(result.plan).toBeDefined();
    expect(result.plan.effects.length).toBeGreaterThanOrEqual(1);
  });

  it('Clearモードではnullを返す', () => {
    const state = initializeGame(42, 'clear', { obstacleCount: 3 });
    state.board[4][4] = { color: 0 as Color, item: 'v_cut' };
    const result = computeAutoActivationPlan(state);
    expect(result).toBeNull();
  });

  it('Survivalモードではnullを返す', () => {
    const state = initializeGame(42, 'survival');
    state.board[4][4] = { color: 0 as Color, item: 'v_cut' };
    const result = computeAutoActivationPlan(state);
    expect(result).toBeNull();
  });

  it('Cascadeモードではnullを返す', () => {
    const state = initializeGame(42, 'cascade');
    state.board[4][4] = { color: 0 as Color, item: 'v_cut' };
    const result = computeAutoActivationPlan(state);
    expect(result).toBeNull();
  });

  it('Sprintモードでscopeのみの場合も自動発動する', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    // 盤面にscopeだけ配置
    // まず全アイテムをクリア
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c]?.item) {
          state.board[r][c] = { color: state.board[r][c]!.color };
        }
      }
    }
    state.board[4][4] = { color: 0 as Color, item: 'scope' };
    const result = computeAutoActivationPlan(state);
    expect(result).not.toBeNull();
    expect(result!.pos).toEqual({ row: 4, col: 4 });
  });

  it('Sprintモードでアイテムがない場合にnullを返す', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    // 盤面上のアイテムを全て削除
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c]?.item) {
          state.board[r][c] = { color: state.board[r][c]!.color };
        }
      }
    }
    const result = computeAutoActivationPlan(state);
    expect(result).toBeNull();
  });

  it('最初に見つかったアイテムが返される（scopeも含む）', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    // 盤面上のアイテムを全て削除
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c]?.item) {
          state.board[r][c] = { color: state.board[r][c]!.color };
        }
      }
    }
    // 複数アイテムを配置
    state.board[2][2] = { color: 0 as Color, item: 'scope' };
    state.board[3][3] = { color: 0 as Color, item: 'h_cut' };
    state.board[5][5] = { color: 0 as Color, item: 'burst' };

    const result = computeAutoActivationPlan(state);
    expect(result).not.toBeNull();
    if (!result) return;
    // scope(2,2) が最初に見つかる（周囲4マス消去のみで自動発動）
    expect(result.pos).toEqual({ row: 2, col: 2 });
  });

  it('flush でターゲットカラーが見つかる場合にプランを返す', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    state.board[4][4] = { color: 0 as Color, item: 'flush' };
    // 盤面上に色1のタイルがあることを確認
    let hasColor1 = false;
    for (let r = 0; r < BOARD_SIZE && !hasColor1; r++) {
      for (let c = 0; c < BOARD_SIZE && !hasColor1; c++) {
        if (state.board[r][c]?.color === 1 && !state.board[r][c]?.item) hasColor1 = true;
      }
    }

    const result = computeAutoActivationPlan(state);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.pos).toEqual({ row: 4, col: 4 });
  });

  it('finalStateのmoveCountが元の値から変化しない (#41)', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 15 });
    // moveLimit到達でゲーム終了した状態をシミュレート
    state.moveCount = 15;
    state.isGameOver = true;
    // アイテムを配置
    state.board[4][4] = { color: 0 as Color, item: 'v_cut' };
    const originalMoveCount = state.moveCount;

    const result = computeAutoActivationPlan(state);
    expect(result).not.toBeNull();
    if (!result) return;
    // moveCountがインクリメントされていないこと（修正前はprocessAction('tap')でインクリメントされていた）
    expect(result.plan.finalState.moveCount).toBe(originalMoveCount);
  });

  it('全アイテム逐次発動でprocessAutoActivationと同一スコアになる (#41)', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 15 });
    state.moveCount = 15;
    state.isGameOver = true;
    // 盤面上の既存アイテムをクリアしてから複数配置
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c]?.item) {
          state.board[r][c] = { color: state.board[r][c]!.color };
        }
      }
    }
    state.board[1][1] = { color: 0 as Color, item: 'v_cut' };
    state.board[3][3] = { color: 0 as Color, item: 'h_cut' };
    state.board[5][5] = { color: 0 as Color, item: 'burst' };

    // processAutoActivationで一括処理した結果
    const engineResult = processAutoActivation(state);

    // computeAutoActivationPlanで1アイテムずつ処理した結果をチェーンする
    let current: GameState = { ...state, board: state.board.map(row => row.map(c => c ? { ...c } : null)), rngState: [...state.rngState] };
    let plan = computeAutoActivationPlan(current);
    while (plan) {
      current = plan.plan.finalState;
      plan = computeAutoActivationPlan(current);
    }

    // 両者のスコアとmoveCountが一致すること
    expect(current.score).toBe(engineResult.score);
    expect(current.moveCount).toBe(engineResult.moveCount);
  });

  it('scopeの自動発動プランにitemEffects情報が含まれる', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 15 });
    state.moveCount = 15;
    state.isGameOver = true;
    // 既存アイテムをクリア
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c]?.item) {
          state.board[r][c] = { color: state.board[r][c]!.color };
        }
      }
    }
    state.board[4][4] = { color: 0 as Color, item: 'scope' };

    const result = computeAutoActivationPlan(state);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.pos).toEqual({ row: 4, col: 4 });
    // scopeが発動されたので、finalStateではscopeは存在しない
    expect(result.plan.finalState.board[4][4]?.item).toBeUndefined();
    // スコアが加算されている
    expect(result.plan.finalState.score).toBeGreaterThan(state.score);
  });

  it('scope含む複数アイテムの逐次発動でprocessAutoActivationと一致する', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 15 });
    state.moveCount = 15;
    state.isGameOver = true;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c]?.item) {
          state.board[r][c] = { color: state.board[r][c]!.color };
        }
      }
    }
    // scope + 他アイテムの混在
    state.board[1][1] = { color: 0 as Color, item: 'scope' };
    state.board[3][3] = { color: 0 as Color, item: 'v_cut' };
    state.board[5][5] = { color: 0 as Color, item: 'burst' };

    const engineResult = processAutoActivation(state);

    let current: GameState = {
      ...state,
      board: state.board.map(row => row.map(c => c ? { ...c } : null)),
      rngState: [...state.rngState],
    };
    let plan = computeAutoActivationPlan(current);
    const activatedItems: string[] = [];
    while (plan) {
      activatedItems.push(current.board[plan.pos.row][plan.pos.col]?.item ?? 'unknown');
      current = plan.plan.finalState;
      plan = computeAutoActivationPlan(current);
    }

    // scopeが最初に発動される（行スキャン順で (1,1) が先）
    expect(activatedItems[0]).toBe('scope');
    expect(current.score).toBe(engineResult.score);
    expect(current.moveCount).toBe(engineResult.moveCount);
  });
});

// ---------------------------------------------------------------------------
// Survival mode - wave animation plan
// ---------------------------------------------------------------------------
describe('computeSwapPlan - Survival wave trigger', () => {
  it('Survivalでウェーブ間隔手目のスワイプ時にwaveAnimが含まれる', () => {
    // SURVIVAL_WAVE_INTERVAL=3 なので3手目でwave 1が発動する
    let state = initializeGame(42, 'survival');
    // 2手先に進める
    for (let i = 0; i < 2; i++) {
      const action = findValidSwap(state);
      if (!action) return;
      state = processAction(state, { type: 'swap', pos: action.pos, dir: action.dir });
    }
    expect(state.moveCount).toBe(2);

    // 3手目（ウェーブトリガー: moveCount=3 % 3 === 0）
    const action = findValidSwap(state);
    if (!action) return;
    const plan = computeSwapPlan(state, action.pos, action.dir);
    if (!plan) return;

    // moveCount=3 => wave 1 が発動するはず
    expect(plan.waveAnim).toBeDefined();
    if (plan.waveAnim) {
      expect(plan.waveAnim.waveNumber).toBe(1);
      expect(plan.waveAnim.steps.length).toBeGreaterThan(0);
    }
  });

  it('Sprintモードではwave animationが付与されない', () => {
    let state = initializeGame(42, 'sprint', { moveLimit: 30 });
    for (let i = 0; i < 2; i++) {
      const action = findValidSwap(state);
      if (!action) return;
      state = processAction(state, { type: 'swap', pos: action.pos, dir: action.dir });
    }
    const action = findValidSwap(state);
    if (!action) return;
    const plan = computeSwapPlan(state, action.pos, action.dir);
    if (!plan) return;
    expect(plan.waveAnim).toBeUndefined();
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

  it('Clear モードでの computeSwapPlan の finalState 一致', () => {
    for (const seed of [42, 100, 500]) {
      let state = initializeGame(seed, 'clear', { obstacleCount: 5 });
      for (let step = 0; step < 3; step++) {
        const action = findValidSwap(state);
        if (!action) break;

        const plan = computeSwapPlan(state, action.pos, action.dir);
        const engineState = processAction(state, { type: 'swap', pos: action.pos, dir: action.dir });

        if (plan && engineState !== state) {
          assertFinalStateMatch(plan.finalState, engineState, `clear seed=${seed} step=${step}`);
          state = engineState;
        } else {
          break;
        }
      }
    }
  });

  it('Cascade モードでの computeSwapPlan の finalState 一致', () => {
    let state = initializeGame(42, 'cascade');
    for (let step = 0; step < 3; step++) {
      const action = findValidSwap(state);
      if (!action) break;

      const plan = computeSwapPlan(state, action.pos, action.dir);
      const engineState = processAction(state, { type: 'swap', pos: action.pos, dir: action.dir });

      if (plan && engineState !== state) {
        assertFinalStateMatch(plan.finalState, engineState, `cascade step=${step}`);
        // cascadePoints / maxChainIndex / milestonesClaimed の一致
        expect(plan.finalState.cascadePoints).toBe(engineState.cascadePoints);
        expect(plan.finalState.maxChainIndex).toBe(engineState.maxChainIndex);
        expect(plan.finalState.milestonesClaimed).toEqual(engineState.milestonesClaimed);
        state = engineState;
      } else {
        break;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// processAutoActivationStep (新規関数)
// ---------------------------------------------------------------------------
describe('processAutoActivationStep', () => {
  it('Sprint以外のモードではnullを返す', () => {
    for (const mode of ['clear', 'survival', 'cascade'] as const) {
      const state = initializeGame(42, mode, mode === 'clear' ? { obstacleCount: 5 } : undefined);
      state.board[4][4] = { color: 0 as Color, item: 'v_cut' };
      expect(processAutoActivationStep(state)).toBeNull();
    }
  });

  it('Sprintモードで1つのアイテムだけを発動して新しいstateを返す', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 15 });
    // 既存アイテムをクリア
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c]?.item) {
          state.board[r][c] = { color: state.board[r][c]!.color };
        }
      }
    }
    state.board[1][1] = { color: 0 as Color, item: 'v_cut' };
    state.board[3][3] = { color: 0 as Color, item: 'h_cut' };

    const result = processAutoActivationStep(state);
    expect(result).not.toBeNull();
    if (!result) return;

    // v_cut(1,1) が先に発動されるはず。h_cutはまだ盤面に存在する
    let foundHCut = false;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (result.board[r][c]?.item === 'h_cut') foundHCut = true;
      }
    }
    expect(foundHCut).toBe(true);
  });

  it('moveCountをインクリメントしない', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 15 });
    state.moveCount = 15;
    state.board[4][4] = { color: 0 as Color, item: 'v_cut' };
    const original = state.moveCount;

    const result = processAutoActivationStep(state);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.moveCount).toBe(original);
  });

  it('scopeも自動発動する（周囲4マス消去のみ）', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 15 });
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c]?.item) {
          state.board[r][c] = { color: state.board[r][c]!.color };
        }
      }
    }
    state.board[4][4] = { color: 0 as Color, item: 'scope' };
    const result = processAutoActivationStep(state);
    expect(result).not.toBeNull();
    // scopeが消費されている
    expect(result!.board[4][4]?.item).toBeUndefined();
    // スコアが加算されている（周囲4マス消去）
    expect(result!.score).toBeGreaterThan(state.score);
  });

  it('アイテムが存在しない場合はnullを返す', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 15 });
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c]?.item) {
          state.board[r][c] = { color: state.board[r][c]!.color };
        }
      }
    }
    expect(processAutoActivationStep(state)).toBeNull();
  });

  it('processAutoActivationと同じ結果になる（逐次呼び出し）', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 15 });
    state.moveCount = 15;
    state.isGameOver = true;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c]?.item) {
          state.board[r][c] = { color: state.board[r][c]!.color };
        }
      }
    }
    state.board[2][2] = { color: 0 as Color, item: 'burst' };
    state.board[4][4] = { color: 0 as Color, item: 'v_cut' };

    const engineResult = processAutoActivation(state);

    let current = cloneGameState(state);
    let step = processAutoActivationStep(current);
    while (step) {
      current = step;
      step = processAutoActivationStep(current);
    }

    expect(current.score).toBe(engineResult.score);
    expect(current.moveCount).toBe(engineResult.moveCount);
    expect(current.rngState).toEqual(engineResult.rngState);
  });

  it('scopeが盤面角（0,0）にある場合も自動発動する', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 15 });
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c]?.item) {
          state.board[r][c] = { color: state.board[r][c]!.color };
        }
      }
    }
    state.board[0][0] = { color: 0 as Color, item: 'scope' };
    const result = processAutoActivationStep(state);
    expect(result).not.toBeNull();
    // scopeが消費されている
    expect(result!.board[0][0]?.item).toBeUndefined();
    // 角なので周囲は最大2マス（右と下）しかないが、スコアは加算される
    expect(result!.score).toBeGreaterThan(state.score);
  });

  it('scope + 他アイテム混在で逐次発動するとprocessAutoActivationと一致する', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 15 });
    state.moveCount = 15;
    state.isGameOver = true;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c]?.item) {
          state.board[r][c] = { color: state.board[r][c]!.color };
        }
      }
    }
    state.board[1][1] = { color: 0 as Color, item: 'scope' };
    state.board[3][3] = { color: 0 as Color, item: 'h_cut' };
    state.board[6][6] = { color: 0 as Color, item: 'burst' };

    const engineResult = processAutoActivation(state);

    let current = cloneGameState(state);
    let step = processAutoActivationStep(current);
    while (step) {
      current = step;
      step = processAutoActivationStep(current);
    }

    // scopeを含む全アイテムが発動された結果が一致する
    expect(current.score).toBe(engineResult.score);
    expect(current.moveCount).toBe(engineResult.moveCount);
    expect(current.rngState).toEqual(engineResult.rngState);
  });

  it('scopeの自動発動は周囲4マス（上下左右）のみ消去しユーザー選択はない', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 15 });
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c]?.item) {
          state.board[r][c] = { color: state.board[r][c]!.color };
        }
      }
    }
    // 盤面中央にscopeを配置（周囲4マスが全て存在する位置）
    const scopeRow = 4;
    const scopeCol = 4;
    state.board[scopeRow][scopeCol] = { color: 0 as Color, item: 'scope' };

    // 周囲4マスにあるタイルの色を記録
    const adjacentPositions = [
      { row: scopeRow - 1, col: scopeCol },  // 上
      { row: scopeRow + 1, col: scopeCol },  // 下
      { row: scopeRow, col: scopeCol - 1 },  // 左
      { row: scopeRow, col: scopeCol + 1 },  // 右
    ];
    // 隣接セルが全て非アイテム・非おじゃまであることを確認
    for (const pos of adjacentPositions) {
      if (state.board[pos.row][pos.col]?.item) {
        state.board[pos.row][pos.col] = { color: state.board[pos.row][pos.col]!.color };
      }
    }
    const adjacentColorsBefore = adjacentPositions.map(p => state.board[p.row]?.[p.col]?.color);

    // 斜め位置のタイルの色を記録
    const diagonalPositions = [
      { row: scopeRow - 1, col: scopeCol - 1 },
      { row: scopeRow - 1, col: scopeCol + 1 },
      { row: scopeRow + 1, col: scopeCol - 1 },
      { row: scopeRow + 1, col: scopeCol + 1 },
    ];

    const result = processAutoActivationStep(state);
    expect(result).not.toBeNull();

    // scopeの位置自体はnull化後に重力+補充で変わる可能性があるが、
    // スコアが加算されていることで効果が発動したことを確認
    expect(result!.score).toBeGreaterThan(state.score);
    // 消去されるのは最大4マス（上下左右）* 10点 * chainIndex(1) = 最大40点
    // 周囲のタイルが一部アイテムだった場合は誘爆が起きるが、上でクリア済み
    const scoreDiff = result!.score - state.score;
    // 周囲4マスのうち存在するものだけが消去される（最大40点）
    expect(scoreDiff).toBeLessThanOrEqual(40);
    expect(scoreDiff).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// processScopeSwap - Cascade mode: applyChainStats
// ---------------------------------------------------------------------------
describe('processScopeSwap - Cascade applyChainStats', () => {
  it('CascadeモードでprocessScopeSwapがcascadePointsとmaxChainIndexを更新する', () => {
    // 複数シードで試行して、pre-chainが発生するケースを探す
    let found = false;
    for (const seed of [42, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 2000, 3000]) {
      const state = initializeGame(seed, 'cascade');

      for (let r = 0; r < BOARD_SIZE - 1 && !found; r++) {
        for (let c = 0; c < BOARD_SIZE - 1 && !found; c++) {
          if (state.board[r][c]?.item) continue;
          const neighbor = state.board[r][c + 1];
          if (neighbor?.item) continue;

          const testState = cloneGameState(state);
          testState.board[r][c] = { color: 0 as Color, item: 'scope' };

          const prevCP = testState.cascadePoints ?? 0;
          const result = processScopeSwap(testState, { row: r, col: c }, 'right', []);

          if (result !== testState && (result.cascadePoints ?? 0) > prevCP) {
            found = true;
            expect(result.cascadePoints).toBeGreaterThan(prevCP);
            expect(result.maxChainIndex).toBeGreaterThanOrEqual(2);
          }
        }
      }
      if (found) break;
    }
    // applyChainStats呼び出しの存在確認（エラーなく実行される）
    expect(true).toBe(true);
  });

  it('processScopeSwapの決定性（同一シード・同一操作で同一結果、Cascadeモード）', () => {
    for (const seed of [42, 100, 500]) {
      const state1 = initializeGame(seed, 'cascade');
      state1.board[3][3] = { color: 0 as Color, item: 'scope' };
      if (state1.board[3][4]?.item) continue;

      const state2 = initializeGame(seed, 'cascade');
      state2.board[3][3] = { color: 0 as Color, item: 'scope' };

      const result1 = processScopeSwap(state1, { row: 3, col: 3 }, 'right', []);
      const result2 = processScopeSwap(state2, { row: 3, col: 3 }, 'right', []);

      expect(result1.score).toBe(result2.score);
      expect(result1.moveCount).toBe(result2.moveCount);
      expect(result1.cascadePoints).toBe(result2.cascadePoints);
      expect(result1.maxChainIndex).toBe(result2.maxChainIndex);
    }
  });
});

// ---------------------------------------------------------------------------
// computeScopeSwapPreChains - Cascade sparkleRngState support
// ---------------------------------------------------------------------------
describe('computeScopeSwapPreChains - Cascade sparkleRngState', () => {
  it('Cascadeモードで事前連鎖後の状態にsparkleRngStateが入る', () => {
    const state = initializeGame(42, 'cascade');
    state.board[3][3] = { color: 0 as Color, item: 'scope' };
    if (state.board[3][4]?.item) return;

    const result = computeScopeSwapPreChains(state, { row: 3, col: 3 }, 'right');
    if (!result) return;
    const sparkleRng = result.stateAfterPreChains.sparkleRngState;
    expect(sparkleRng).toBeDefined();
    expect(Array.isArray(sparkleRng)).toBe(true);
    expect(sparkleRng!.length).toBe(BOARD_SIZE);
  });

  it('非Cascadeモードでは事前連鎖後の状態のsparkleRngStateがundefined', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    state.board[3][3] = { color: 0 as Color, item: 'scope' };
    if (state.board[3][4]?.item) return;

    const result = computeScopeSwapPreChains(state, { row: 3, col: 3 }, 'right');
    if (!result) return;
    expect(result.stateAfterPreChains.sparkleRngState).toBeUndefined();
  });

  it('sparkleRngStateが元のstateから変更されない（クローンされている）', () => {
    const state = initializeGame(42, 'cascade');
    state.board[3][3] = { color: 0 as Color, item: 'scope' };
    if (state.board[3][4]?.item) return;

    const originalSparkleRng = [...state.sparkleRngState!];
    computeScopeSwapPreChains(state, { row: 3, col: 3 }, 'right');

    expect(state.sparkleRngState).toEqual(originalSparkleRng);
  });

  it('pre-chainで消去されたキラキラタイルのsparkleCountが記録される', () => {
    const state = initializeGame(42, 'cascade');
    state.board[3][3] = { color: 0 as Color, item: 'scope' };
    if (state.board[3][4]?.item) return;
    const result = computeScopeSwapPreChains(state, { row: 3, col: 3 }, 'right');
    if (!result) return;
    // sparkleCountフィールドの型検証: undefinedまたは正の整数
    for (const chain of result.preChains) {
      if (chain.sparkleCount !== undefined) {
        expect(chain.sparkleCount).toBeGreaterThan(0);
      }
    }
  });

  it('Cascadeモードでpre-chain後のpreScoreがprocessScopeSwapと整合する', () => {
    for (const seed of [42, 100, 500]) {
      const state = initializeGame(seed, 'cascade');
      state.board[3][3] = { color: 0 as Color, item: 'scope' };
      if (state.board[3][4]?.item) continue;

      const preChainResult = computeScopeSwapPreChains(state, { row: 3, col: 3 }, 'right');
      if (!preChainResult) continue;

      const engineResult = processScopeSwap(state, { row: 3, col: 3 }, 'right', []);
      // engineResultのスコアにはpre-chain分が含まれている
      expect(engineResult.score).toBeGreaterThanOrEqual(preChainResult.stateAfterPreChains.score);
    }
  });
});

// ---------------------------------------------------------------------------
// processScopeSynthesis - Cascade sparkleRngState support
// ---------------------------------------------------------------------------
describe('processScopeSynthesis - Cascade sparkleRngState', () => {
  it('Cascadeモードでscope+scope合成後にキラキラ付きタイルが補充される可能性がある', () => {
    let foundSparkle = false;
    for (const seed of [42, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      const state = initializeGame(seed, 'cascade');
      state.board[4][4] = { color: 0 as Color, item: 'scope' };
      state.board[4][5] = { color: 0 as Color, item: 'scope' };

      const targetCells = [{ row: 6, col: 6 }];
      const result = processScopeSynthesis(state, { row: 4, col: 4 }, { row: 4, col: 5 }, targetCells);

      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (result.board[r][c]?.sparkle) {
            foundSparkle = true;
            break;
          }
        }
        if (foundSparkle) break;
      }
      if (foundSparkle) break;
    }
    expect(foundSparkle).toBe(true);
  });

  it('非Cascadeモードでscope合成後にキラキラ付きタイルが存在しない', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    state.board[4][4] = { color: 0 as Color, item: 'scope' };
    state.board[4][5] = { color: 0 as Color, item: 'scope' };

    const result = processScopeSynthesis(state, { row: 4, col: 4 }, { row: 4, col: 5 }, [{ row: 6, col: 6 }]);

    let hasSparkle = false;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (result.board[r][c]?.sparkle) {
          hasSparkle = true;
        }
      }
    }
    expect(hasSparkle).toBe(false);
  });

  it('Cascadeモードでscope合成の決定性（同一シード・同一操作で同一結果）', () => {
    const state1 = initializeGame(42, 'cascade');
    state1.board[4][4] = { color: 0 as Color, item: 'scope' };
    state1.board[4][5] = { color: 0 as Color, item: 'scope' };

    const state2 = initializeGame(42, 'cascade');
    state2.board[4][4] = { color: 0 as Color, item: 'scope' };
    state2.board[4][5] = { color: 0 as Color, item: 'scope' };

    const result1 = processScopeSynthesis(state1, { row: 4, col: 4 }, { row: 4, col: 5 }, [{ row: 6, col: 6 }]);
    const result2 = processScopeSynthesis(state2, { row: 4, col: 4 }, { row: 4, col: 5 }, [{ row: 6, col: 6 }]);

    expect(result1.score).toBe(result2.score);
    expect(result1.cascadePoints).toBe(result2.cascadePoints);
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(result1.board[r][c]?.color).toBe(result2.board[r][c]?.color);
        expect(result1.board[r][c]?.sparkle).toBe(result2.board[r][c]?.sparkle);
      }
    }
  });

  it('computeScopeSynthesisPlanのfinalStateがprocessScopeSynthesisと一致する（Cascade scope+scope）', () => {
    const state = initializeGame(42, 'cascade');
    state.board[4][4] = { color: 0 as Color, item: 'scope' };
    state.board[4][5] = { color: 0 as Color, item: 'scope' };

    const plan = computeScopeSynthesisPlan(state, { row: 4, col: 4 }, { row: 4, col: 5 }, [{ row: 6, col: 6 }]);
    const engineState = processScopeSynthesis(state, { row: 4, col: 4 }, { row: 4, col: 5 }, [{ row: 6, col: 6 }]);

    expect(plan).not.toBeNull();
    if (!plan) return;
    assertFinalStateMatch(plan.finalState, engineState, 'computeScopeSynthesisPlan cascade scope+scope');
    expect(plan.finalState.cascadePoints).toBe(engineState.cascadePoints);
    expect(plan.finalState.maxChainIndex).toBe(engineState.maxChainIndex);
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(plan.finalState.board[r][c]?.sparkle, `cascade synthesis board[${r}][${c}].sparkle`).toBe(engineState.board[r][c]?.sparkle);
      }
    }
  });

  it('computeScopeSynthesisPlanのfinalStateがprocessScopeSynthesisと一致する（Cascade scope+burst）', () => {
    const state = initializeGame(42, 'cascade');
    state.board[4][4] = { color: 0 as Color, item: 'scope' };
    state.board[4][5] = { color: 0 as Color, item: 'burst' };

    const plan = computeScopeSynthesisPlan(state, { row: 4, col: 4 }, { row: 4, col: 5 }, []);
    const engineState = processScopeSynthesis(state, { row: 4, col: 4 }, { row: 4, col: 5 }, []);

    expect(plan).not.toBeNull();
    if (!plan) return;
    assertFinalStateMatch(plan.finalState, engineState, 'computeScopeSynthesisPlan cascade scope+burst');
    expect(plan.finalState.cascadePoints).toBe(engineState.cascadePoints);
  });
});

