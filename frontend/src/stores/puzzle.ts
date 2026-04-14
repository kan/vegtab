import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  initializeGame, processAction, processScopeSynthesis,
  peekNextColors, peekNextTiles,
  countObstacles,
  currentWaveNumber, movesUntilNextWave, waveObstacleCount,
  previewWaveNumber, previewWavePositions,
  calcItemEffectScore,
  computeAutoActivationPlan as engineComputeAutoActivationPlan,
  computeItemSwapPlan as engineComputeItemSwapPlan,
  computeItemTapPlan as engineComputeItemTapPlan,
  computeScopePlan as engineComputeScopePlan,
  computeScopeSwapPreChains as engineComputeScopeSwapPreChains,
  computeScopeSynthesisPlan as engineComputeScopeSynthesisPlan,
  computeSwapPlan as engineComputeSwapPlan,
  computeSynthesisPlan as engineComputeSynthesisPlan,
  type GameState, type GameMode, type Position, type Direction,
  type Cell, type Color, type ItemType,
  type Action,
  type ChainAnimData, type SwapAnimPlan, type ItemEffectStep,
  type ItemAnimPlan, type WaveAnimStep, type WaveAnimPlan,
  type SynthesisAnimPlan, type ScopeAnimPlan, type ScopeSynthesisAnimPlan,
  type ScopeSwapPreChainResult,
  NUM_COLORS,
  computeMaxChainPotential,
} from '@vegtab/engine';

// Re-export animation types and calcItemEffectScore for consumers (PuzzleBoard.vue etc.)
export { calcItemEffectScore };
export type {
  ChainAnimData, SwapAnimPlan, ItemEffectStep,
  ItemAnimPlan, WaveAnimStep, WaveAnimPlan,
  SynthesisAnimPlan, ScopeAnimPlan, ScopeSynthesisAnimPlan,
};

/** Replay action — extends engine Action with scope synthesis and scope swap */
export type ReplayAction = Action
  | { type: 'scope_synthesis'; pos1: Position; pos2: Position; targetCells: Position[] }
  | { type: 'scope_swap'; pos: Position; dir: Direction; targetCells: Position[] }
  | { type: 'auto_activate' };

// --- Store ---

export const usePuzzleStore = defineStore('puzzle', () => {
  const gameState = ref<GameState | null>(null);
  const seed = ref(0);

  // Replay log: records every player action for replay viewer
  const replayLog = ref<ReplayAction[]>([]);

  // Stats tracking for achievements
  const maxChain = ref(0);
  const generatedItemTypes = ref<Set<string>>(new Set());

  const board = computed(() => gameState.value?.board ?? null);
  // displayScore overrides score during chain animations for real-time display
  const _displayScore = ref<number | null>(null);
  const score = computed(() => _displayScore.value ?? (gameState.value?.score ?? 0));
  const moveCount = computed(() => gameState.value?.moveCount ?? 0);
  const autoActivating = ref(false);
  const isGameOver = computed(() => gameState.value?.isGameOver ?? false);
  const mode = computed<GameMode>(() => gameState.value?.mode ?? 'sprint');
  const moveLimit = computed(() => gameState.value?.moveLimit);
  const isCleared = computed(() => gameState.value?.isCleared);
  const remainingMoves = computed(() => {
    if (!gameState.value || !gameState.value.moveLimit) return undefined;
    if (gameState.value.mode !== 'sprint' && gameState.value.mode !== 'cascade') return undefined;
    return gameState.value.moveLimit - gameState.value.moveCount;
  });
  const obstacleCount = computed(() => {
    if (!gameState.value) return 0;
    return countObstacles(gameState.value.board);
  });
  const maxChainIndex = computed(() => gameState.value?.maxChainIndex ?? 0);
  const cascadePoints = computed(() => gameState.value?.cascadePoints ?? 0);
  const milestonesClaimed = computed<number[]>(() => gameState.value?.milestonesClaimed ?? []);
  /** Cascade mode: preview of next tiles per column (color + sparkle) */
  const nextTilePreview = computed<{ color: Color; sparkle: boolean }[][] | null>(() => {
    if (!gameState.value || gameState.value.mode !== 'cascade') return null;
    if (gameState.value.sparkleRngState) {
      return peekNextTiles(gameState.value.rngState, gameState.value.sparkleRngState, 4, gameState.value.numColors ?? NUM_COLORS);
    }
    // fallback (sparkleRngStateがない場合)
    return peekNextColors(gameState.value.rngState, 4, gameState.value.numColors ?? NUM_COLORS)
      .map(col => col.map(color => ({ color, sparkle: false })));
  });
  /** Cascade mode: 全スワイプ候補から算出した最大連鎖ポテンシャル */
  const chainPotential = computed(() => {
    if (!gameState.value || gameState.value.mode !== 'cascade' || gameState.value.isGameOver) return 0;
    return computeMaxChainPotential(gameState.value);
  });

  // --- Cascade chain meter ---
  const currentChainMeterLevel = ref(0);
  function resetChainMeter() { currentChainMeterLevel.value = 0; }
  function setChainMeterLevel(level: number) { currentChainMeterLevel.value = level; }

  // --- Survival wave state ---
  /** 現在までに発生済みのウェーブ番号（未発生なら0） */
  const waveNumber = computed(() => {
    if (!gameState.value || gameState.value.mode !== 'survival') return undefined;
    return currentWaveNumber(gameState.value.moveCount);
  });
  /** 次のウェーブまでの残りターン数 */
  const movesUntilWave = computed(() => {
    if (!gameState.value || gameState.value.mode !== 'survival') return undefined;
    return movesUntilNextWave(gameState.value.moveCount);
  });
  /** 次に発生するウェーブの番号（予告中かに関わらず常に有効） */
  const nextWaveNumber = computed(() => {
    if (!gameState.value || gameState.value.mode !== 'survival') return undefined;
    return currentWaveNumber(gameState.value.moveCount) + 1;
  });
  /** 次のウェーブで侵食される個数 */
  const nextWaveObstacleCount = computed(() => {
    if (nextWaveNumber.value === undefined) return undefined;
    return waveObstacleCount(nextWaveNumber.value);
  });
  /** 予告中（SURVIVAL_WAVE_PREVIEW_LEAD 以内）のウェーブ番号。予告中でなければ null */
  const wavePreviewNumber = computed(() => {
    if (!gameState.value || gameState.value.mode !== 'survival') return null;
    return previewWaveNumber(gameState.value.moveCount);
  });
  /** 予告中のウェーブ侵食位置リスト（予告中でなければ空配列）
   * PuzzleBoardで各セルに preview フラグを立てる判定に使う。 */
  const wavePreviewPositions = computed<Position[]>(() => {
    if (!gameState.value || gameState.value.mode !== 'survival') return [];
    const seed = gameState.value.seed;
    if (seed === undefined) return [];
    const positions = previewWavePositions(seed, gameState.value.moveCount);
    return positions ?? [];
  });
  /** 予告位置を row,col キーの Set で取得（O(1) 判定用） */
  const wavePreviewKeySet = computed<Set<string>>(() => {
    const s = new Set<string>();
    for (const p of wavePreviewPositions.value) s.add(`${p.row},${p.col}`);
    return s;
  });
  /** 予告位置のうち耐久値3のおじゃまがある位置（次ウェーブで耐久値4=即死） */
  const wavePreviewLethalKeySet = computed<Set<string>>(() => {
    const s = new Set<string>();
    const b = board.value;
    if (!b) return s;
    for (const p of wavePreviewPositions.value) {
      const cell = b[p.row]?.[p.col];
      if (cell?.obstacle && cell.obstacle.durability >= 3) {
        s.add(`${p.row},${p.col}`);
      }
    }
    return s;
  });

  function startGame(newSeed?: number, gameMode?: GameMode) {
    seed.value = newSeed ?? Math.floor(Math.random() * 0x7FFFFFFF);
    replayLog.value = [];
    maxChain.value = 0;
    generatedItemTypes.value = new Set();
    gameState.value = initializeGame(seed.value, gameMode ?? 'sprint');
  }

  function restoreState(savedSeed: number, state: GameState, savedMaxChain: number, savedItemTypes: string[], savedReplayLog?: ReplayAction[]) {
    seed.value = savedSeed;
    replayLog.value = savedReplayLog ?? [];
    maxChain.value = savedMaxChain;
    generatedItemTypes.value = new Set(savedItemTypes);
    gameState.value = state;
  }

  /** Record an action to the replay log (called by PuzzleBoard before applyState) */
  function recordAction(action: ReplayAction) {
    replayLog.value.push(action);
  }

  function swap(pos: Position, dir: Direction) {
    if (!gameState.value) return;
    const newState = processAction(gameState.value, { type: 'swap', pos, dir });
    if (newState !== gameState.value) gameState.value = newState;
  }

  function tap(pos: Position) {
    if (!gameState.value) return;
    const newState = processAction(gameState.value, { type: 'tap', pos });
    if (newState !== gameState.value) gameState.value = newState;
  }

  function activateScope(pos: Position, targetCells: Position[]) {
    if (!gameState.value) return;
    const newState = processAction(gameState.value, {
      type: 'scope', pos, targetCells,
    });
    if (newState !== gameState.value) gameState.value = newState;
  }

  function applyScopeSynthesis(pos1: Position, pos2: Position, targetCells: Position[]) {
    if (!gameState.value) return;
    const newState = processScopeSynthesis(gameState.value, pos1, pos2, targetCells);
    if (newState !== gameState.value) gameState.value = newState;
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

  /** Record chain/item stats from animation plan data for achievement tracking */
  function recordPlanStats(chains: ChainAnimData[]) {
    for (const chain of chains) {
      if (chain.chainIndex > maxChain.value) {
        maxChain.value = chain.chainIndex;
      }
      for (const ig of chain.itemGens) {
        generatedItemTypes.value.add(ig.item);
      }
    }
  }

  /** Sprint auto-activation: compute plan for the next item on the board */
  function computeAutoActivationPlan(): { pos: Position; plan: ItemAnimPlan } | null {
    if (!gameState.value) return null;
    return engineComputeAutoActivationPlan(gameState.value);
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
    board, score, moveCount, autoActivating, isGameOver, isCleared,
    mode, moveLimit, remainingMoves, maxChainIndex, cascadePoints, milestonesClaimed, nextTilePreview,
    chainPotential, currentChainMeterLevel, resetChainMeter, setChainMeterLevel,
    obstacleCount,
    waveNumber, movesUntilWave, nextWaveNumber, nextWaveObstacleCount,
    wavePreviewNumber, wavePreviewPositions, wavePreviewKeySet, wavePreviewLethalKeySet,
    startGame, restoreState, recordAction, swap, tap,
    activateScope, applyScopeSynthesis,
    computeScopePlan, computeScopeSwapPreChains, computeScopeSynthesisPlan,
    computeSwapPlan, computeItemTapPlan, computeItemSwapPlan, computeSynthesisPlan,
    computeAutoActivationPlan,
    applyState, setDisplayScore, placeItem, placeObstacle,
    maxChain, generatedItemTypes, recordPlanStats,
  };
});
