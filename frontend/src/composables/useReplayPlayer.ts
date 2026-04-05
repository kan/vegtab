import { ref, computed, reactive, onUnmounted } from 'vue';
import {
  initializeGame, processAction, processScopeSynthesis, processScopeSwap, processAutoActivation,
  cloneGameState, cloneBoard,
  findMatches, getUniquePositions, applyGravity, fillEmptyCells,
  processDamage, determineItemFromMatches,
  type GameState, type GameMode, type Cell, type GameInitParams,
  type Position, type Direction, type ItemType, type Color,
  BOARD_SIZE, NUM_COLORS,
} from '@vegtab/engine';
import type { ReplayAction } from '@/stores/puzzle';

/** Chain intermediate step for animation */
interface ChainStep {
  matchedPositions: Position[];
  boardAfterDrop: (Cell | null)[][];
}

/** Pre-computed animation data for a single replay action */
interface StepAnimData {
  boardAfterSwap?: (Cell | null)[][];
  chains: ChainStep[];
}

function getAdjacentPos(pos: Position, dir: Direction): Position {
  switch (dir) {
    case 'up': return { row: pos.row - 1, col: pos.col };
    case 'down': return { row: pos.row + 1, col: pos.col };
    case 'left': return { row: pos.row, col: pos.col - 1 };
    case 'right': return { row: pos.row, col: pos.col + 1 };
  }
}

/** Compute chain intermediate boards for a swap action (mirrors engine processAction + processChains) */
function computeSwapChains(state: GameState, pos: Position, dir: Direction): StepAnimData {
  const board = cloneBoard(state.board);
  const target = getAdjacentPos(pos, dir);
  const nc = state.numColors ?? NUM_COLORS;
  const passThrough = state.mode === 'clear';

  // Swap
  const tmp = board[pos.row][pos.col];
  board[pos.row][pos.col] = board[target.row][target.col];
  board[target.row][target.col] = tmp;
  const boardAfterSwap = cloneBoard(board);

  const chains: ChainStep[] = [];
  let rng = [...state.rngState];

  // --- 1連鎖目 (ユーザースワイプ直後) ---
  let matches = findMatches(board);
  if (matches.length === 0) return { boardAfterSwap, chains };

  // アイテム生成 (1連鎖目は即時配置)
  const itemGens1 = determineItemFromMatches(matches, [pos, target]);

  const cleared1 = getUniquePositions(matches);
  for (const p of cleared1) board[p.row][p.col] = null;

  // アイテム即時配置
  for (const ig of itemGens1) {
    board[ig.pos.row][ig.pos.col] = { color: 0 as Color, item: ig.item };
  }

  // おじゃまダメージ (落下+補充含む)
  rng = processDamage(board, cleared1, rng, state.mode, nc);

  // 落下 → 補充
  applyGravity(board, passThrough);
  rng = fillEmptyCells(board, rng, nc);

  chains.push({ matchedPositions: [...cleared1], boardAfterDrop: cloneBoard(board) });

  // --- 2連鎖目以降 (processChains相当) ---
  matches = findMatches(board);
  while (matches.length > 0) {
    const itemGens = determineItemFromMatches(matches);

    const cleared = getUniquePositions(matches);
    for (const p of cleared) board[p.row][p.col] = null;

    // アイテムを即座に配置（重力前）
    for (const ig of itemGens) {
      board[ig.pos.row][ig.pos.col] = { color: 0 as Color, item: ig.item };
    }

    // おじゃまダメージ (落下+補充含む)
    rng = processDamage(board, cleared, rng, state.mode, nc);

    // 落下 → 補充
    applyGravity(board, passThrough);
    rng = fillEmptyCells(board, rng, nc);

    chains.push({ matchedPositions: [...cleared], boardAfterDrop: cloneBoard(board) });
    matches = findMatches(board);
  }

  return { boardAfterSwap, chains };
}

export function useReplayPlayer() {
  const actions = ref<ReplayAction[]>([]);
  const gameStates = ref<GameState[]>([]);
  const chainCounts = ref<number[]>([]);
  const stepAnimations = ref<StepAnimData[]>([]);
  const currentStep = ref(0);
  const isPlaying = ref(false);
  const speed = ref(1000);
  const recordedFinalScore = ref<number | null>(null);
  const recordedCascadePoints = ref<number | null>(null);

  // Animation state
  const isAnimating = ref(false);
  const animBoard = ref<(Cell | null)[][] | null>(null);
  const matchedCells = reactive(new Set<string>());
  const clearingCells = reactive(new Set<string>());
  let animCancelled = false;

  let playTimer: ReturnType<typeof setTimeout> | null = null;

  const totalSteps = computed(() => actions.value.length);

  const currentState = computed<GameState | null>(() =>
    gameStates.value[currentStep.value] ?? null,
  );

  const currentBoard = computed<(Cell | null)[][] | null>(() =>
    animBoard.value ?? currentState.value?.board ?? null,
  );

  const isAtEnd = computed(() => currentStep.value >= totalSteps.value);
  const currentScore = computed(() => {
    if (isAtEnd.value && recordedFinalScore.value !== null) return recordedFinalScore.value;
    return currentState.value?.score ?? 0;
  });
  const currentMoveCount = computed(() => currentState.value?.moveCount ?? 0);
  const currentCascadePoints = computed(() => {
    if (isAtEnd.value && recordedCascadePoints.value !== null) return recordedCascadePoints.value;
    return currentState.value?.cascadePoints ?? 0;
  });

  const currentAction = computed<ReplayAction | null>(() =>
    currentStep.value > 0 ? actions.value[currentStep.value - 1] ?? null : null,
  );

  const nextAction = computed<ReplayAction | null>(() =>
    actions.value[currentStep.value] ?? null,
  );

  function wait(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  function cancelAnimation() {
    animCancelled = true;
    animBoard.value = null;
    matchedCells.clear();
    clearingCells.clear();
    isAnimating.value = false;
  }

  function load(
    seed: number, mode: GameMode, replayActions: ReplayAction[], params?: GameInitParams,
    recorded?: { finalScore?: number; cascadePoints?: number },
  ) {
    pause();
    cancelAnimation();
    actions.value = replayActions;
    recordedFinalScore.value = recorded?.finalScore ?? null;
    recordedCascadePoints.value = recorded?.cascadePoints ?? null;

    const states: GameState[] = [];
    const chains: number[] = [];
    const anims: StepAnimData[] = [];
    let state = initializeGame(seed, mode, params);
    states.push(state);

    for (const action of replayActions) {
      // Compute chain animation data for swap actions
      if (action.type === 'swap') {
        anims.push(computeSwapChains(state, action.pos, action.dir));
      } else {
        anims.push({ chains: [] });
      }

      // Compute final state (authoritative — engine handles all special cases)
      if (action.type === 'scope_synthesis') {
        state = processScopeSynthesis(state, action.pos1, action.pos2, action.targetCells);
      } else if (action.type === 'scope_swap') {
        state = processScopeSwap(state, action.pos, action.dir, action.targetCells);
      } else if (action.type !== 'auto_activate') {
        state = processAction(state, action);
      }
      states.push(state);
      chains.push(state.lastChainCount ?? 0);

      // Sync animation final board with authoritative engine state.
      // computeSwapChains only handles simple swaps; item activation,
      // synthesis, etc. can produce different results. Overwrite the
      // last chain's boardAfterDrop so the next step starts correctly.
      const anim = anims[anims.length - 1];
      if (anim.chains.length > 0) {
        anim.chains[anim.chains.length - 1].boardAfterDrop = cloneBoard(state.board);
      }
    }

    // Sprint auto-activation
    if (state.isGameOver && mode === 'sprint') {
      const afterAuto = processAutoActivation(state);
      if (afterAuto.score !== state.score) {
        actions.value = [...replayActions, { type: 'auto_activate' as const }];
        states.push(afterAuto);
        chains.push(0);
        anims.push({ chains: [] });
      }
    }

    gameStates.value = states;
    chainCounts.value = chains;
    stepAnimations.value = anims;
    currentStep.value = 0;
  }

  function goTo(step: number) {
    cancelAnimation();
    const clamped = Math.max(0, Math.min(step, totalSteps.value));
    currentStep.value = clamped;
  }

  async function next() {
    if (isAnimating.value) return;
    if (currentStep.value >= totalSteps.value) {
      pause();
      return;
    }

    const stepIndex = currentStep.value;
    const anim = stepAnimations.value[stepIndex];

    // If this step has chain animation data, play it
    if (anim && anim.chains.length > 0) {
      isAnimating.value = true;
      animCancelled = false;
      const factor = 1000 / speed.value; // speed.value=1000 → factor=1, 500→2, etc.

      // Show board after swap
      if (anim.boardAfterSwap) {
        animBoard.value = anim.boardAfterSwap;
        await wait(150 / factor);
        if (animCancelled) return;
      }

      // Animate each chain step
      for (const chain of anim.chains) {
        if (animCancelled) return;

        // Highlight matched cells
        for (const p of chain.matchedPositions) matchedCells.add(`${p.row},${p.col}`);
        await wait(350 / factor);
        if (animCancelled) return;

        // Clear animation
        for (const p of chain.matchedPositions) clearingCells.add(`${p.row},${p.col}`);
        await wait(250 / factor);
        if (animCancelled) return;

        matchedCells.clear();
        clearingCells.clear();

        // Show board after drop
        animBoard.value = chain.boardAfterDrop;
        await wait(200 / factor);
        if (animCancelled) return;
      }

      animBoard.value = null;
      isAnimating.value = false;
    }

    currentStep.value = stepIndex + 1;
  }

  function prev() {
    cancelAnimation();
    if (currentStep.value > 0) {
      currentStep.value--;
    }
  }

  function play() {
    if (currentStep.value >= totalSteps.value) {
      currentStep.value = 0;
    }
    isPlaying.value = true;
    scheduleNext();
  }

  function pause() {
    isPlaying.value = false;
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
  }

  async function scheduleNext() {
    if (!isPlaying.value) return;
    if (currentStep.value >= totalSteps.value) {
      isPlaying.value = false;
      return;
    }

    await next();
    if (!isPlaying.value) return;

    // Wait between steps (only for non-animated steps, animated ones have built-in timing)
    const anim = stepAnimations.value[currentStep.value - 1];
    if (!anim || anim.chains.length === 0) {
      await wait(speed.value);
    } else {
      // Brief pause after animation before next step
      await wait(Math.max(200, speed.value / 3));
    }

    scheduleNext();
  }

  function setSpeed(ms: number) {
    speed.value = ms;
    // No need to restart timer — scheduleNext is async and reads speed.value each iteration
  }

  onUnmounted(() => {
    pause();
    cancelAnimation();
  });

  return {
    actions,
    chainCounts,
    currentStep,
    totalSteps,
    currentState,
    currentBoard,
    currentScore,
    currentMoveCount,
    currentCascadePoints,
    recordedFinalScore,
    recordedCascadePoints,
    currentAction,
    nextAction,
    isPlaying,
    isAnimating,
    matchedCells,
    clearingCells,
    speed,
    load,
    goTo,
    next,
    prev,
    play,
    pause,
    setSpeed,
  };
}
