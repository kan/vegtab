import { ref, computed, reactive, onUnmounted } from 'vue';
import {
  initializeGame, applyReplayAction,
  computeSwapPlan,
  type GameState, type Cell, type ChainAnimData,
} from '@vegtab/engine';
import type { ReplayAction } from '@/stores/puzzle';

/** Pre-computed animation data for a single replay action */
interface StepAnimData {
  boardAfterSwap?: (Cell | null)[][];
  chains: ChainAnimData[];
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

  function load(seed: number, replayActions: ReplayAction[], recorded?: { finalScore?: number }) {
    pause();
    cancelAnimation();
    actions.value = replayActions;
    recordedFinalScore.value = recorded?.finalScore ?? null;

    const states: GameState[] = [];
    const chains: number[] = [];
    const anims: StepAnimData[] = [];
    let state = initializeGame(seed);
    states.push(state);

    for (const action of replayActions) {
      // 通常スワイプは実プレイと同じ engine のプランから連鎖の途中盤面と結果を得る
      // （アイテムを含むスワイプなどはプランが null になり、連鎖アニメなしで結果だけ求める）
      const plan = action.type === 'swap' ? computeSwapPlan(state, action.pos, action.dir) : null;
      if (plan) {
        anims.push({ boardAfterSwap: plan.boardAfterSwap, chains: plan.chains });
        state = plan.finalState;
      } else {
        anims.push({ chains: [] });
        state = applyReplayAction(state, action);
      }
      states.push(state);
      chains.push(state.lastChainCount ?? 0);
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
        for (const p of chain.clearedPositions) matchedCells.add(`${p.row},${p.col}`);
        await wait(350 / factor);
        if (animCancelled) return;

        // Clear animation
        for (const p of chain.clearedPositions) clearingCells.add(`${p.row},${p.col}`);
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
    recordedFinalScore,
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
