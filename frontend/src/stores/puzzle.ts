import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  initializeGame, processAction, processScopeSynthesis,
  countObstacles,
  calcItemEffectScore,
  computeItemSwapPlan as engineComputeItemSwapPlan,
  computeItemTapPlan as engineComputeItemTapPlan,
  computeScopePlan as engineComputeScopePlan,
  computeScopeSwapPreChains as engineComputeScopeSwapPreChains,
  computeScopeSynthesisPlan as engineComputeScopeSynthesisPlan,
  computeSwapPlan as engineComputeSwapPlan,
  computeSynthesisPlan as engineComputeSynthesisPlan,
  type GameState, type Position, type Direction,
  type Cell, type Color, type ItemType,
  type ChainAnimData, type SwapAnimPlan, type ItemEffectStep,
  type ItemAnimPlan,
  type SynthesisAnimPlan, type ScopeAnimPlan, type ScopeSynthesisAnimPlan,
  type ScopeSwapPreChainResult,
} from '@vegtab/engine';

// Re-export animation types and calcItemEffectScore for consumers (PuzzleBoard.vue etc.)
export { calcItemEffectScore };
export type {
  ChainAnimData, SwapAnimPlan, ItemEffectStep,
  ItemAnimPlan,
  SynthesisAnimPlan, ScopeAnimPlan, ScopeSynthesisAnimPlan,
};

/** Replay action — defined in the engine so the backend verifies the same shape */
export type ReplayAction = import('@vegtab/engine').ReplayAction;

// --- Store ---

export const usePuzzleStore = defineStore('puzzle', () => {
  const gameState = ref<GameState | null>(null);
  const seed = ref(0);

  // Replay log: records every player action for replay viewer
  const replayLog = ref<ReplayAction[]>([]);

  // Stats tracking for achievements (the max chain is re-simulated by the server from the replay log)
  const generatedItemTypes = ref<Set<string>>(new Set());

  const board = computed(() => gameState.value?.board ?? null);
  // displayScore overrides score during chain animations for real-time display
  const _displayScore = ref<number | null>(null);
  const score = computed(() => _displayScore.value ?? (gameState.value?.score ?? 0));
  const moveCount = computed(() => gameState.value?.moveCount ?? 0);
  const isGameOver = computed(() => gameState.value?.isGameOver ?? false);
  const isCleared = computed(() => gameState.value?.isCleared);
  const obstacleCount = computed(() => {
    if (!gameState.value) return 0;
    return countObstacles(gameState.value.board);
  });

  function startGame(newSeed: number) {
    seed.value = newSeed;
    replayLog.value = [];
    generatedItemTypes.value = new Set();
    gameState.value = initializeGame(seed.value);
  }

  function restoreState(savedSeed: number, state: GameState, savedItemTypes: string[], savedReplayLog?: ReplayAction[]) {
    seed.value = savedSeed;
    replayLog.value = savedReplayLog ?? [];
    generatedItemTypes.value = new Set(savedItemTypes);
    gameState.value = state;
  }

  /** Record an action to the replay log (called by PuzzleBoard before applyState) */
  function recordAction(action: ReplayAction) {
    replayLog.value.push(action);
  }

  /** Apply a scope activation; returns whether the board changed */
  function activateScope(pos: Position, targetCells: Position[]): boolean {
    return applyIfChanged(state => processAction(state, { type: 'scope', pos, targetCells }));
  }

  /** Apply a scope synthesis; returns whether the board changed */
  function applyScopeSynthesis(pos1: Position, pos2: Position, targetCells: Position[]): boolean {
    return applyIfChanged(state => processScopeSynthesis(state, pos1, pos2, targetCells));
  }

  function applyIfChanged(step: (state: GameState) => GameState): boolean {
    if (!gameState.value) return false;
    const newState = step(gameState.value);
    if (newState === gameState.value) return false;
    gameState.value = newState;
    return true;
  }

  function computeScopePlan(scopePos: Position, targetCells: Position[]): ScopeAnimPlan | null {
    if (!gameState.value) return null;
    return engineComputeScopePlan(gameState.value, scopePos, targetCells);
  }

  /** #15: Compute pre-chains for scope swap (before user enters selection mode) */
  function computeScopeSwapPreChains(pos: Position, dir: Direction): ScopeSwapPreChainResult | null {
    if (!gameState.value) return null;
    return engineComputeScopeSwapPreChains(gameState.value, pos, dir);
  }

  function computeScopeSynthesisPlan(
    pos1: Position, pos2: Position, targetCells: Position[],
  ): ScopeSynthesisAnimPlan | null {
    if (!gameState.value) return null;
    return engineComputeScopeSynthesisPlan(gameState.value, pos1, pos2, targetCells);
  }

  function computeSwapPlan(pos: Position, dir: Direction): SwapAnimPlan | null {
    if (!gameState.value) return null;
    return engineComputeSwapPlan(gameState.value, pos, dir);
  }

  function computeItemTapPlan(pos: Position): ItemAnimPlan | null {
    if (!gameState.value) return null;
    return engineComputeItemTapPlan(gameState.value, pos);
  }

  function computeItemSwapPlan(pos: Position, dir: Direction): {
    boardAfterSwap: (Cell | null)[][];
    preChains: ChainAnimData[];
    preScore: number;
    plan: ItemAnimPlan;
  } | null {
    if (!gameState.value) return null;
    return engineComputeItemSwapPlan(gameState.value, pos, dir);
  }

  function computeSynthesisPlan(pos: Position, dir: Direction): SynthesisAnimPlan | null {
    if (!gameState.value) return null;
    return engineComputeSynthesisPlan(gameState.value, pos, dir);
  }

  /** Record generated item types from animation plan data for achievement tracking */
  function recordPlanStats(chains: ChainAnimData[]) {
    for (const chain of chains) {
      for (const ig of chain.itemGens) {
        generatedItemTypes.value.add(ig.item);
      }
    }
  }

  function setDisplayScore(s: number) { _displayScore.value = s; }

  function applyState(state: GameState) {
    _displayScore.value = null;
    gameState.value = state;
  }

  /** Debug-only: place an item on the board */
  function placeItem(pos: Position, item: ItemType) {
    if (!gameState.value) return;
    const cell = gameState.value.board[pos.row]?.[pos.col];
    if (!cell) return;
    gameState.value.board[pos.row][pos.col] = { color: 0 as Color, item };
  }

  /** Debug-only: place an obstacle on the board */
  function placeObstacle(pos: Position, durability: number) {
    if (!gameState.value) return;
    const cell = gameState.value.board[pos.row]?.[pos.col];
    if (!cell) return;
    gameState.value.board[pos.row][pos.col] = { color: 0 as Color, obstacle: { durability } };
  }

  return {
    gameState, seed, replayLog,
    board, score, moveCount, isGameOver, isCleared,
    obstacleCount,
    startGame, restoreState, recordAction,
    activateScope, applyScopeSynthesis,
    computeScopePlan, computeScopeSwapPreChains, computeScopeSynthesisPlan,
    computeSwapPlan, computeItemTapPlan, computeItemSwapPlan, computeSynthesisPlan,
    applyState, setDisplayScore, placeItem, placeObstacle,
    generatedItemTypes, recordPlanStats,
  };
});
