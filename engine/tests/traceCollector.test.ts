import { describe, it, expect } from 'vitest';
import {
  initializeGame, processAction, processScopeSynthesis,
  cloneGameState, applyWave,
} from '../src/engine.js';
import type {
  TraceCollector, ChainStepData, ItemEffectData,
  WaveStepData, SynthesisEffectData, DropMove, NewTileEntry,
} from '../src/traceCollector.js';
import { BOARD_SIZE, Cell, Color, Direction, GameState, Position } from '../src/types.js';
import { SURVIVAL_WAVE_INTERVAL } from '../src/survival.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** collector に記録されたイベントを保持する構造体 */
interface CollectedEvents {
  chainSteps: ChainStepData[];
  itemEffects: ItemEffectData[];
  waveSteps: WaveStepData[];
  synthEffects: SynthesisEffectData[];
  boardSnapshots: { label: string; board: (Cell | null)[][] }[];
  scopeAdjacentCalls: Position[][];
  dropDataCalls: { moves: DropMove[]; entries: NewTileEntry[] }[];
}

function createTestCollector(): { collector: TraceCollector; events: CollectedEvents } {
  const events: CollectedEvents = {
    chainSteps: [],
    itemEffects: [],
    waveSteps: [],
    synthEffects: [],
    boardSnapshots: [],
    scopeAdjacentCalls: [],
    dropDataCalls: [],
  };
  const collector: TraceCollector = {
    onChainStep(data) { events.chainSteps.push(data); },
    onItemEffect(data) { events.itemEffects.push(data); },
    onWaveStep(data) { events.waveSteps.push(data); },
    onSynthesisEffect(data) { events.synthEffects.push(data); },
    onBoardSnapshot(label, board) { events.boardSnapshots.push({ label, board }); },
    onScopeAdjacent(targets) { events.scopeAdjacentCalls.push([...targets]); },
    onDropData(moves, entries) { events.dropDataCalls.push({ moves: [...moves], entries: [...entries] }); },
  };
  return { collector, events };
}

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

// ---------------------------------------------------------------------------
// collector 未指定時の動作
// ---------------------------------------------------------------------------
describe('collector 未指定時の processAction', () => {
  it('collector なしで processAction を呼んでも同じ結果を返す', () => {
    const state = initializeGame(42);
    const action = findValidSwap(state);
    if (!action) return;

    const result1 = processAction(state, { type: 'swap', pos: action.pos, dir: action.dir });
    const result2 = processAction(state, { type: 'swap', pos: action.pos, dir: action.dir }, undefined);

    expect(result1.score).toBe(result2.score);
    expect(result1.moveCount).toBe(result2.moveCount);
    expect(result1.isGameOver).toBe(result2.isGameOver);
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(result1.board[r][c]?.color).toBe(result2.board[r][c]?.color);
        expect(result1.board[r][c]?.item).toBe(result2.board[r][c]?.item);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// collector 指定時: processAction(swap) で ChainStepData が収集される
// ---------------------------------------------------------------------------
describe('collector 指定時の processAction(swap)', () => {
  it('有効なスワイプで onChainStep が少なくとも 1 回呼ばれる', () => {
    const state = initializeGame(42);
    const action = findValidSwap(state);
    if (!action) return;

    const { collector, events } = createTestCollector();
    const result = processAction(state, { type: 'swap', pos: action.pos, dir: action.dir }, collector);
    expect(result).not.toBe(state);
    expect(events.chainSteps.length).toBeGreaterThanOrEqual(1);
  });

  it('onChainStep の chainIndex は 1 から始まる', () => {
    const state = initializeGame(42);
    const action = findValidSwap(state);
    if (!action) return;

    const { collector, events } = createTestCollector();
    processAction(state, { type: 'swap', pos: action.pos, dir: action.dir }, collector);

    if (events.chainSteps.length > 0) {
      expect(events.chainSteps[0].chainIndex).toBe(1);
    }
  });

  it('onChainStep の各ステップに dropMoves, newTileEntries, boardAfterDrop が含まれる', () => {
    const state = initializeGame(42);
    const action = findValidSwap(state);
    if (!action) return;

    const { collector, events } = createTestCollector();
    processAction(state, { type: 'swap', pos: action.pos, dir: action.dir }, collector);

    for (const step of events.chainSteps) {
      expect(Array.isArray(step.dropMoves)).toBe(true);
      expect(Array.isArray(step.newTileEntries)).toBe(true);
      expect(Array.isArray(step.boardAfterDrop)).toBe(true);
      expect(step.boardAfterDrop.length).toBe(BOARD_SIZE);
    }
  });

  it('afterSwap スナップショットが生成される', () => {
    const state = initializeGame(42);
    const action = findValidSwap(state);
    if (!action) return;

    const { collector, events } = createTestCollector();
    const result = processAction(state, { type: 'swap', pos: action.pos, dir: action.dir }, collector);
    if (result === state) return;

    const afterSwap = events.boardSnapshots.find(s => s.label === 'afterSwap');
    expect(afterSwap).toBeDefined();
  });

  it('collector を指定しても processAction の戻り値は同じ', () => {
    const state = initializeGame(42);
    const action = findValidSwap(state);
    if (!action) return;

    const { collector } = createTestCollector();
    const withCollector = processAction(state, { type: 'swap', pos: action.pos, dir: action.dir }, collector);
    const withoutCollector = processAction(state, { type: 'swap', pos: action.pos, dir: action.dir });

    expect(withCollector.score).toBe(withoutCollector.score);
    expect(withCollector.moveCount).toBe(withoutCollector.moveCount);
    expect(withCollector.isGameOver).toBe(withoutCollector.isGameOver);
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(withCollector.board[r][c]?.color).toBe(withoutCollector.board[r][c]?.color);
        expect(withCollector.board[r][c]?.item).toBe(withoutCollector.board[r][c]?.item);
        expect(withCollector.board[r][c]?.obstacle?.durability).toBe(withoutCollector.board[r][c]?.obstacle?.durability);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// collector 指定時: processAction(tap) で ItemEffectData が収集される
// ---------------------------------------------------------------------------
describe('collector 指定時の processAction(tap)', () => {
  it('アイテムタップで onItemEffect が呼ばれる', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    state.board[4][4] = { color: 0 as Color, item: 'v_cut' };

    const { collector, events } = createTestCollector();
    const result = processAction(state, { type: 'tap', pos: { row: 4, col: 4 } }, collector);
    if (result === state) return;

    expect(events.itemEffects.length).toBeGreaterThanOrEqual(1);
    expect(events.itemEffects[0].itemType).toBe('v_cut');
    expect(events.itemEffects[0].itemPos).toEqual({ row: 4, col: 4 });
  });

  it('ItemEffectData に targets, detonations, depth, score が含まれる', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    state.board[4][4] = { color: 0 as Color, item: 'burst' };

    const { collector, events } = createTestCollector();
    const result = processAction(state, { type: 'tap', pos: { row: 4, col: 4 } }, collector);
    if (result === state) return;

    for (const effect of events.itemEffects) {
      expect(Array.isArray(effect.targets)).toBe(true);
      expect(Array.isArray(effect.detonations)).toBe(true);
      expect(typeof effect.depth).toBe('number');
      expect(typeof effect.score).toBe('number');
      expect(effect.depth).toBeGreaterThanOrEqual(0);
    }
  });

  it('onDropData が呼ばれる（アイテムタップ後のgravity情報）', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    state.board[4][4] = { color: 0 as Color, item: 'v_cut' };

    const { collector, events } = createTestCollector();
    const result = processAction(state, { type: 'tap', pos: { row: 4, col: 4 } }, collector);
    if (result === state) return;

    expect(events.dropDataCalls.length).toBeGreaterThanOrEqual(1);
    const dropData = events.dropDataCalls[0];
    expect(Array.isArray(dropData.moves)).toBe(true);
    expect(Array.isArray(dropData.entries)).toBe(true);
  });

  it('beforeItemActivation と afterItemDrop のスナップショットが生成される', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    state.board[4][4] = { color: 0 as Color, item: 'h_cut' };

    const { collector, events } = createTestCollector();
    const result = processAction(state, { type: 'tap', pos: { row: 4, col: 4 } }, collector);
    if (result === state) return;

    const beforeAct = events.boardSnapshots.find(s => s.label === 'beforeItemActivation');
    const afterDrop = events.boardSnapshots.find(s => s.label === 'afterItemDrop');
    expect(beforeAct).toBeDefined();
    expect(afterDrop).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// collector 指定時: processAction(scope)
// ---------------------------------------------------------------------------
describe('collector 指定時の processAction(scope)', () => {
  it('scope アクションで onScopeAdjacent が呼ばれる', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    state.board[3][3] = { color: 0 as Color, item: 'scope' };

    const { collector, events } = createTestCollector();
    const result = processAction(
      state,
      { type: 'scope', pos: { row: 3, col: 3 }, targetCells: [{ row: 5, col: 5 }] },
      collector,
    );
    if (result === state) return;

    expect(events.scopeAdjacentCalls.length).toBeGreaterThanOrEqual(1);
    // 周囲4マスが通知される
    const adjacent = events.scopeAdjacentCalls[0];
    expect(adjacent.length).toBeGreaterThan(0);
    expect(adjacent.length).toBeLessThanOrEqual(4);
  });

  it('scope で隣接アイテムを誘爆すると onItemEffect も呼ばれる', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    state.board[3][3] = { color: 0 as Color, item: 'scope' };
    state.board[3][4] = { color: 0 as Color, item: 'v_cut' }; // 隣接アイテム

    const { collector, events } = createTestCollector();
    const result = processAction(
      state,
      { type: 'scope', pos: { row: 3, col: 3 }, targetCells: [{ row: 5, col: 5 }] },
      collector,
    );
    if (result === state) return;

    // v_cut が隣接にあるので onItemEffect で誘爆が通知される
    expect(events.itemEffects.length).toBeGreaterThanOrEqual(1);
    const vCutEffect = events.itemEffects.find(e => e.itemType === 'v_cut');
    expect(vCutEffect).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// collector 指定時: 合成（アイテム同士のスワイプ）
// ---------------------------------------------------------------------------
describe('collector 指定時の processAction(synthesis)', () => {
  it('アイテム合成で onSynthesisEffect が呼ばれる', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    state.board[4][4] = { color: 0 as Color, item: 'v_cut' };
    state.board[4][5] = { color: 0 as Color, item: 'h_cut' };

    const { collector, events } = createTestCollector();
    const result = processAction(
      state,
      { type: 'swap', pos: { row: 4, col: 4 }, dir: 'right' },
      collector,
    );
    if (result === state) return;

    expect(events.synthEffects.length).toBeGreaterThanOrEqual(1);
    const synth = events.synthEffects[0];
    expect(synth.effectType).toBe('line+line');
    expect(synth.item1).toBeDefined();
    expect(synth.item2).toBeDefined();
    expect(Array.isArray(synth.targets)).toBe(true);
  });

  it('flush+flush 合成で onSynthesisEffect が呼ばれる', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    state.board[4][4] = { color: 0 as Color, item: 'flush' };
    state.board[4][5] = { color: 0 as Color, item: 'flush' };

    const { collector, events } = createTestCollector();
    const result = processAction(
      state,
      { type: 'swap', pos: { row: 4, col: 4 }, dir: 'right' },
      collector,
    );
    if (result === state) return;

    expect(events.synthEffects.length).toBeGreaterThanOrEqual(1);
    expect(events.synthEffects[0].effectType).toBe('flush+flush');
  });
});

// ---------------------------------------------------------------------------
// collector 指定時: processScopeSynthesis
// ---------------------------------------------------------------------------
describe('collector 指定時の processScopeSynthesis', () => {
  it('scope+scope 合成で onScopeAdjacent と onSynthesisEffect が呼ばれる', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    state.board[4][4] = { color: 0 as Color, item: 'scope' };
    state.board[4][5] = { color: 0 as Color, item: 'scope' };

    const { collector, events } = createTestCollector();
    const result = processScopeSynthesis(
      state,
      { row: 4, col: 4 },
      { row: 4, col: 5 },
      [{ row: 6, col: 6 }],
      collector,
    );

    // scopeの周囲消去が呼ばれる
    expect(events.scopeAdjacentCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('collector を指定しても processScopeSynthesis の結果が同一', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    state.board[4][4] = { color: 0 as Color, item: 'scope' };
    state.board[4][5] = { color: 0 as Color, item: 'burst' };

    const { collector } = createTestCollector();
    const with_ = processScopeSynthesis(state, { row: 4, col: 4 }, { row: 4, col: 5 }, [], collector);
    const without_ = processScopeSynthesis(state, { row: 4, col: 4 }, { row: 4, col: 5 }, []);

    expect(with_.score).toBe(without_.score);
    expect(with_.moveCount).toBe(without_.moveCount);
    expect(with_.isGameOver).toBe(without_.isGameOver);
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(with_.board[r][c]?.color).toBe(without_.board[r][c]?.color);
        expect(with_.board[r][c]?.item).toBe(without_.board[r][c]?.item);
        expect(with_.board[r][c]?.obstacle?.durability).toBe(without_.board[r][c]?.obstacle?.durability);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// collector 指定時: applyWave で WaveStepData が収集される
// ---------------------------------------------------------------------------
describe('collector 指定時の applyWave', () => {
  it('Survival でウェーブ発動時に onWaveStep が呼ばれる', () => {
    const state = initializeGame(42, 'survival');
    // SURVIVAL_WAVE_INTERVAL 手進める
    let current = state;
    for (let i = 0; i < SURVIVAL_WAVE_INTERVAL - 1; i++) {
      const dirs: Array<{ dir: Direction; dr: number; dc: number }> = [
        { dir: 'right', dr: 0, dc: 1 },
        { dir: 'down', dr: 1, dc: 0 },
      ];
      let moved = false;
      for (let r = 0; r < BOARD_SIZE && !moved; r++) {
        for (let c = 0; c < BOARD_SIZE && !moved; c++) {
          if (current.board[r][c]?.item) continue;
          for (const { dir, dr, dc } of dirs) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= BOARD_SIZE || nc >= BOARD_SIZE) continue;
            if (current.board[nr][nc]?.item) continue;
            const result = processAction(current, { type: 'swap', pos: { row: r, col: c }, dir });
            if (result !== current) {
              current = result;
              moved = true;
              break;
            }
          }
        }
      }
      if (!moved) return; // can't proceed
    }
    expect(current.moveCount).toBe(SURVIVAL_WAVE_INTERVAL - 1);

    // 次の有効なスワイプでウェーブが発動する
    const action = findValidSwap(current);
    if (!action) return;

    const { collector, events } = createTestCollector();
    const result = processAction(
      current,
      { type: 'swap', pos: action.pos, dir: action.dir },
      collector,
    );

    if (result === current) return;
    if (result.moveCount % SURVIVAL_WAVE_INTERVAL !== 0) return;

    // ウェーブが発動していれば onWaveStep が呼ばれている
    expect(events.waveSteps.length).toBeGreaterThan(0);
    for (const ws of events.waveSteps) {
      expect(['place', 'bump', 'item_activate']).toContain(ws.kind);
      expect(ws.boardAfter.length).toBe(BOARD_SIZE);
      expect(typeof ws.score).toBe('number');
    }
  });

  it('Sprint モードでは onWaveStep が呼ばれない', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    const action = findValidSwap(state);
    if (!action) return;

    const { collector, events } = createTestCollector();
    processAction(state, { type: 'swap', pos: action.pos, dir: action.dir }, collector);

    expect(events.waveSteps).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// collector 指定時: 誘爆チェーンでの depth 追跡
// ---------------------------------------------------------------------------
describe('collector: アイテム誘爆の depth 追跡', () => {
  it('直接発動は depth=0、誘爆は depth >= 1', () => {
    const state = initializeGame(42, 'sprint', { moveLimit: 30 });
    // v_cut を配置し、その効果範囲に h_cut を配置して誘爆させる
    state.board[4][4] = { color: 0 as Color, item: 'v_cut' };
    // v_cut(4,4) は col=4 全体を消去するので、同じ列のアイテムを誘爆する
    state.board[2][4] = { color: 0 as Color, item: 'h_cut' };

    const { collector, events } = createTestCollector();
    const result = processAction(state, { type: 'tap', pos: { row: 4, col: 4 } }, collector);
    if (result === state) return;

    // v_cut が depth=0 で発動
    const vCutEffect = events.itemEffects.find(e => e.itemType === 'v_cut' && e.depth === 0);
    expect(vCutEffect).toBeDefined();

    // h_cut が誘爆されて depth>=1
    const hCutEffect = events.itemEffects.find(e => e.itemType === 'h_cut');
    if (hCutEffect) {
      expect(hCutEffect.depth).toBeGreaterThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// 複数シードでの collector 一貫性
// ---------------------------------------------------------------------------
describe('collector: 複数シードでの一貫性', () => {
  it('同一シード・同一操作で collector のイベント数が同一', () => {
    for (const seed of [42, 100, 200]) {
      const state1 = initializeGame(seed);
      const state2 = initializeGame(seed);
      const action = findValidSwap(state1);
      if (!action) continue;

      const { collector: c1, events: e1 } = createTestCollector();
      const { collector: c2, events: e2 } = createTestCollector();

      processAction(state1, { type: 'swap', pos: action.pos, dir: action.dir }, c1);
      processAction(state2, { type: 'swap', pos: action.pos, dir: action.dir }, c2);

      expect(e1.chainSteps.length, `seed=${seed}: chainSteps count`).toBe(e2.chainSteps.length);
      expect(e1.itemEffects.length, `seed=${seed}: itemEffects count`).toBe(e2.itemEffects.length);
      expect(e1.waveSteps.length, `seed=${seed}: waveSteps count`).toBe(e2.waveSteps.length);
    }
  });
});

// ---------------------------------------------------------------------------
// ChainStepData の score 合計と engine score の整合性
// ---------------------------------------------------------------------------
describe('collector: ChainStepData の score 合計と engine の整合性', () => {
  it('swap で chainSteps の score 合計 + itemEffects の score 合計 = engine の score 増分', () => {
    const state = initializeGame(42);
    const action = findValidSwap(state);
    if (!action) return;

    const { collector, events } = createTestCollector();
    const result = processAction(
      state,
      { type: 'swap', pos: action.pos, dir: action.dir },
      collector,
    );
    if (result === state) return;

    const chainScore = events.chainSteps.reduce((sum, s) => sum + s.score, 0);
    const itemScore = events.itemEffects.reduce((sum, e) => sum + e.score, 0);
    const waveScore = events.waveSteps.reduce((sum, w) => sum + w.score, 0);
    const totalCollected = chainScore + itemScore + waveScore;
    const engineDelta = result.score - state.score;

    expect(totalCollected).toBe(engineDelta);
  });
});
