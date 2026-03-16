import { ref, computed, onUnmounted } from 'vue';
import {
  initializeGame, processAction, processScopeSynthesis, processScopeSwap, processAutoActivation,
  cloneGameState,
  type GameState, type GameMode, type Cell, type GameInitParams,
  type Direction,
} from '@tomado/engine';
import type { ReplayAction } from '@/stores/puzzle';

export function useReplayPlayer() {
  const actions = ref<ReplayAction[]>([]);
  const gameStates = ref<GameState[]>([]);
  const currentStep = ref(0);
  const isPlaying = ref(false);
  const speed = ref(1000); // ms per step

  let playTimer: ReturnType<typeof setTimeout> | null = null;

  const totalSteps = computed(() => actions.value.length);

  const currentState = computed<GameState | null>(() =>
    gameStates.value[currentStep.value] ?? null,
  );

  const currentBoard = computed<(Cell | null)[][] | null>(() =>
    currentState.value?.board ?? null,
  );

  const currentScore = computed(() => currentState.value?.score ?? 0);
  const currentMoveCount = computed(() => currentState.value?.moveCount ?? 0);

  const currentAction = computed<ReplayAction | null>(() =>
    currentStep.value > 0 ? actions.value[currentStep.value - 1] ?? null : null,
  );

  const nextAction = computed<ReplayAction | null>(() =>
    actions.value[currentStep.value] ?? null,
  );

  function load(seed: number, mode: GameMode, replayActions: ReplayAction[], params?: GameInitParams) {
    pause();
    actions.value = replayActions;

    // Build all states by replaying actions
    const states: GameState[] = [];
    let state = initializeGame(seed, mode, params);
    states.push(state);

    for (const action of replayActions) {
      if (action.type === 'scope_synthesis') {
        state = processScopeSynthesis(state, action.pos1, action.pos2, action.targetCells);
      } else if (action.type === 'scope_swap') {
        state = processScopeSwap(state, action.pos, action.dir, action.targetCells);
      } else if (action.type !== 'auto_activate') {
        state = processAction(state, action);
      }
      states.push(state);
    }

    // Sprint auto-activation: process remaining items after game over
    if (state.isGameOver && mode === 'sprint') {
      const afterAuto = processAutoActivation(state);
      if (afterAuto.score !== state.score) {
        actions.value = [...replayActions, { type: 'auto_activate' }];
        states.push(afterAuto);
      }
    }

    gameStates.value = states;
    currentStep.value = 0;
  }

  function goTo(step: number) {
    const clamped = Math.max(0, Math.min(step, totalSteps.value));
    currentStep.value = clamped;
  }

  function next() {
    if (currentStep.value < totalSteps.value) {
      currentStep.value++;
    } else {
      pause();
    }
  }

  function prev() {
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

  function scheduleNext() {
    if (!isPlaying.value) return;
    playTimer = setTimeout(() => {
      if (!isPlaying.value) return;
      if (currentStep.value < totalSteps.value) {
        currentStep.value++;
        scheduleNext();
      } else {
        isPlaying.value = false;
      }
    }, speed.value);
  }

  function setSpeed(ms: number) {
    speed.value = ms;
    if (isPlaying.value) {
      if (playTimer) clearTimeout(playTimer);
      scheduleNext();
    }
  }

  onUnmounted(() => {
    pause();
  });

  return {
    actions,
    currentStep,
    totalSteps,
    currentState,
    currentBoard,
    currentScore,
    currentMoveCount,
    currentAction,
    nextAction,
    isPlaying,
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
