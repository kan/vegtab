import { ref, computed, reactive } from 'vue';
import type { Position, Direction, Cell } from '@vegtab/engine';
import { allTutorialSteps, getSectionForStep, type TutorialStep } from '@/data/tutorialSteps';
import { pk, adj } from '@/composables/useDragHandler';
import { playSE, vibrate } from '@/sound';

const STORAGE_KEY = 'tomado_tutorial';

interface TutorialProgress {
  completed: boolean;
  lastStep: number;
  version: number;
}

/** Check if this is the user's first visit (no tutorial record at all) */
export function isTutorialFirstVisit(): boolean {
  return !localStorage.getItem(STORAGE_KEY);
}

/** Mark tutorial as dismissed (seen prompt but skipped) without creating a composable instance */
export function dismissTutorialPrompt(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ completed: false, lastStep: 0, version: 1 }));
  } catch { /* ignore */ }
}

export function useTutorialPlayer() {
  // Fixed 2x speed for tutorial animations (independent of game speed setting)
  const TUTORIAL_SPEED = 2;
  const ANIM = {
    MATCH_SHOW: 350 / TUTORIAL_SPEED,
    CLEAR: 250 / TUTORIAL_SPEED,
  };
  function scaled(ms: number) { return ms / TUTORIAL_SPEED; }

  // State
  const currentStepIndex = ref(0);
  const displayBoard = ref<(Cell | null)[][] | null>(null);
  const matchedCells = reactive(new Set<string>());
  const clearingCells = reactive(new Set<string>());
  const isAnimating = ref(false);
  const stepCompleted = ref(false);
  const showTryItPrompt = ref(false);
  const showSuccessMessage = ref(false);

  // Computed
  const currentStep = computed<TutorialStep>(() => allTutorialSteps[currentStepIndex.value]);
  const totalSteps = allTutorialSteps.length;
  const currentSectionIndex = computed(() => getSectionForStep(currentStepIndex.value));
  const isFirstStep = computed(() => currentStepIndex.value === 0);
  const isLastStep = computed(() => currentStepIndex.value === totalSteps - 1);
  const activeBoard = computed(() => displayBoard.value ?? currentStep.value.board ?? null);

  // Helpers
  function wait(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

  // --- Step initialization ---
  function initStep() {
    matchedCells.clear();
    clearingCells.clear();
    isAnimating.value = false;
    stepCompleted.value = false;
    showTryItPrompt.value = false;
    showSuccessMessage.value = false;
    displayBoard.value = null;

    const step = currentStep.value;
    if (step.type === 'info') {
      stepCompleted.value = true;
    } else if (step.type === 'demo') {
      // Auto-play after short delay
      setTimeout(() => playDemoAnimation(), scaled(800));
    } else if (step.type === 'guided') {
      showTryItPrompt.value = true;
    }
  }

  /** Shared match sequence: plays matchPhases or single matchedCells */
  async function playMatchSequence(step: TutorialStep): Promise<void> {
    if (step.matchPhases) {
      for (const phase of step.matchPhases) {
        await animateMatch(phase.matched);
        displayBoard.value = phase.boardAfter;
        await wait(scaled(300));
      }
    } else if (step.matchedCells) {
      await animateMatch(step.matchedCells);
      if (step.boardAfterAction) {
        displayBoard.value = step.boardAfterAction;
      }
    }
  }

  // --- Demo animation ---
  async function playDemoAnimation(): Promise<void> {
    const step = currentStep.value;
    if (isAnimating.value || !step.board) return;
    isAnimating.value = true;
    displayBoard.value = step.board;

    await playMatchSequence(step);

    await wait(scaled(400));
    isAnimating.value = false;
    stepCompleted.value = true;
  }

  // --- Match animation ---
  async function animateMatch(cells: Position[]): Promise<void> {
    // Highlight matched
    playSE('match'); vibrate(15);
    for (const p of cells) matchedCells.add(pk(p.row, p.col));
    await wait(ANIM.MATCH_SHOW);

    // Clear
    playSE('clear');
    for (const p of cells) clearingCells.add(pk(p.row, p.col));
    await wait(ANIM.CLEAR);

    matchedCells.clear();
    clearingCells.clear();
  }

  // --- Guided: validate user action ---
  function validateSwap(pos: Position, dir: Direction): boolean {
    const step = currentStep.value;
    if (step.type !== 'guided' || isAnimating.value || stepCompleted.value) return false;

    const expected = step.expectedAction;
    if (!expected || expected.type !== 'swap') return false;

    if (pos.row === expected.pos.row && pos.col === expected.pos.col && dir === expected.dir) {
      playGuidedResult();
      return true;
    }

    // Also accept swap from the other cell in the opposite direction
    const oppDir: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };
    const targetPos = adj(expected.pos, expected.dir);
    if (pos.row === targetPos.row && pos.col === targetPos.col && dir === oppDir[expected.dir]) {
      playGuidedResult();
      return true;
    }

    return false;
  }

  function validateTap(pos: Position): boolean {
    const step = currentStep.value;
    if (step.type !== 'guided' || isAnimating.value || stepCompleted.value) return false;

    const expected = step.expectedAction;
    if (!expected || expected.type !== 'tap') return false;

    if (pos.row === expected.pos.row && pos.col === expected.pos.col) {
      playGuidedResult();
      return true;
    }
    return false;
  }

  async function playGuidedResult(): Promise<void> {
    const step = currentStep.value;
    isAnimating.value = true;
    showTryItPrompt.value = false;
    displayBoard.value = step.board ?? null;

    await playMatchSequence(step);

    await wait(scaled(300));
    showSuccessMessage.value = true;
    playSE('complete'); vibrate(20);
    isAnimating.value = false;
    stepCompleted.value = true;
  }

  // --- Navigation ---
  function goToStep(index: number) {
    if (index < 0 || index >= totalSteps) return;
    currentStepIndex.value = index;
    initStep();
    saveProgress();
  }

  function nextStep() {
    if (currentStepIndex.value < totalSteps - 1) {
      goToStep(currentStepIndex.value + 1);
    }
  }

  function prevStep() {
    if (currentStepIndex.value > 0) {
      goToStep(currentStepIndex.value - 1);
    }
  }

  function restartDemo() {
    const step = currentStep.value;
    if (step.type === 'demo') {
      matchedCells.clear();
      clearingCells.clear();
      isAnimating.value = false;
      stepCompleted.value = false;
      displayBoard.value = step.board ?? null;
      setTimeout(() => playDemoAnimation(), scaled(500));
    }
  }

  // --- Progress persistence ---
  function loadProgress(): TutorialProgress {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return { completed: false, lastStep: 0, version: 1 };
  }

  function saveProgress() {
    try {
      const progress: TutorialProgress = {
        completed: currentStepIndex.value >= totalSteps - 1,
        lastStep: currentStepIndex.value,
        version: 1,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch { /* ignore */ }
  }

  function markCompleted() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        completed: true,
        lastStep: totalSteps - 1,
        version: 1,
      }));
    } catch { /* ignore */ }
  }

  // Initialize first step
  initStep();

  return {
    // State
    currentStepIndex,
    currentStep,
    currentSectionIndex,
    totalSteps,
    displayBoard,
    activeBoard,
    matchedCells,
    clearingCells,
    isAnimating,
    stepCompleted,
    showTryItPrompt,
    showSuccessMessage,
    isFirstStep,
    isLastStep,

    // Actions
    initStep,
    goToStep,
    nextStep,
    prevStep,
    restartDemo,
    validateSwap,
    validateTap,
    playDemoAnimation,

    // Progress
    loadProgress,
    saveProgress,
    markCompleted,
  };
}
