<script setup lang="ts">
import { ref, computed, provide, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { countObstacles } from '@vegtab/engine';
import PuzzleBoard from '@/components/PuzzleBoard.vue';
import NameDialog from '@/components/NameDialog.vue';
import { useTutorialPuzzleStore, PUZZLE_STORE_KEY } from '@/stores/puzzle';
import { useGameStore } from '@/stores/game';
import { useAchievementStore } from '@/stores/achievements';
import { api } from '@/api/client';
import { playSE, vibrate } from '@/sound';
import { todayJST } from '@/utils/date';
import type { BoardInput } from '@/lib/boardInput';
import { LESSONS } from '@/tutorial/lessons';
import { markTutorialSeen } from '@/tutorial/progress';

/**
 * The hands-on tutorial (#108), as TAKO-SEN's: each lesson is a small board on the real engine and
 * the real PuzzleBoard, on the tutorial's own puzzle store (today's game is left alone). The board
 * takes only the current task's inputs; a task's move settling starts the next task. After the last
 * lesson (a free one, cleared by playing normally) comes the summary
 */
const { t } = useI18n();
const router = useRouter();
const gameStore = useGameStore();
const store = useTutorialPuzzleStore();
provide(PUZZLE_STORE_KEY, store);

const lessonIndex = ref(0);
/** Tasks done in this lesson; the lesson is done when it reaches the task count */
const taskIndex = ref(0);
/** Bumped on every (re)start of a lesson to remount the board, so its animation state starts clean */
const attempt = ref(0);
const finished = ref(false);
const showNameDialog = ref(false);

const lesson = computed(() => LESSONS[lessonIndex.value]);
const task = computed(() => lesson.value.tasks[taskIndex.value] ?? null);
const isFree = computed(() => lesson.value.tasks.length === 0);
const lessonDone = computed(() => isFree.value ? !!store.isCleared : taskIndex.value >= lesson.value.tasks.length);
const stuck = computed(() => isFree.value && store.isGameOver && !store.isCleared);

const bodyKey = computed(() => {
  if (lessonDone.value) return `tutorial.${lesson.value.id}.done`;
  if (stuck.value) return 'tutorial.free.stuck';
  return task.value?.bodyKey ?? 'tutorial.free.body';
});

const hints = computed(() => {
  if (!task.value || lessonDone.value || store.animating || !store.gameState) return [];
  return task.value.hints(store.gameState);
});

function guard(input: BoardInput): boolean {
  if (lessonDone.value) return false;
  if (isFree.value) return true;
  return !!store.gameState && !!task.value?.accepts(input, store.gameState);
}

function startLesson() {
  taskIndex.value = 0;
  store.restoreState(0, lesson.value.start(), []);
  attempt.value++;
}

function onSettled() {
  if (!isFree.value) taskIndex.value++;
  if (lessonDone.value) { playSE('complete'); vibrate(20); }
}

function nextLesson() {
  if (lessonIndex.value < LESSONS.length - 1) {
    lessonIndex.value++;
    startLesson();
  } else {
    finish();
  }
}

function finish() {
  finished.value = true;
  const achievements = useAchievementStore();
  if (!achievements.getState('tutorial_complete')?.isUnlocked) {
    achievements.handleNewAchievements(['tutorial_complete']);
    api('/api/achievements/unlock', {
      method: 'POST',
      body: JSON.stringify({ type: 'tutorial_complete' }),
    }).catch(() => { /* offline: kept in localStorage */ });
  }
}

function playToday() {
  router.push(`/puzzle/${gameStore.generateDailySeed(todayJST())}`);
}


// The store outlives the page, so set the first lesson up before the board first renders.
// In dev, ?lesson=N opens lesson N (1-based) directly
const devLesson = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('lesson')) : 0;
if (devLesson >= 1 && devLesson <= LESSONS.length) lessonIndex.value = devLesson - 1;
startLesson();
onMounted(markTutorialSeen);
</script>

<template>
  <div class="tutorial-view">
    <header class="tutorial-header">
      <button class="btn btn-sm back-btn" :aria-label="t('common.home')" @click="router.push('/')">&larr;</button>
      <h1 class="header-title">{{ t('tutorial.title') }}</h1>
      <span class="header-spacer" />
    </header>

    <template v-if="!finished">
      <section class="card lesson-card">
        <p class="lesson-progress">{{ t('tutorial.progress', { n: lessonIndex + 1, total: LESSONS.length }) }}</p>
        <h2 class="lesson-title">{{ t(lesson.titleKey) }}</h2>
        <p class="lesson-body" aria-live="polite">{{ t(bodyKey) }}</p>
        <ul v-if="lesson.doneList && lessonDone" class="done-list">
          <li v-for="k in lesson.doneList" :key="k">{{ t(k) }}</li>
        </ul>
        <p v-if="isFree && !lessonDone" class="free-status">
          {{ t('tutorial.free.status', { obstacles: store.gameState ? countObstacles(store.gameState.board) : 0, moves: store.moveCount }) }}
        </p>
        <div class="lesson-actions">
          <button class="btn" :disabled="store.animating" @click="startLesson">{{ t('tutorial.retry') }}</button>
          <button v-if="lessonDone" class="btn btn-primary" @click="nextLesson">{{ t('tutorial.next') }}</button>
        </div>
      </section>

      <div class="board-area">
        <PuzzleBoard
          :key="attempt"
          :guard="guard"
          :hints="hints"
          @settled="onSettled"
        />
      </div>
    </template>

    <section v-else class="card summary-card">
      <h2 class="lesson-title">{{ t('tutorial.summary.title') }}</h2>
      <p class="lesson-body">{{ t('tutorial.summary.daily') }}</p>
      <p class="lesson-body">{{ t('tutorial.summary.ranking') }}</p>
      <p class="lesson-body">{{ t('tutorial.summary.again') }}</p>
      <div class="summary-actions">
        <button class="btn btn-primary" @click="playToday">{{ t('tutorial.summary.playToday') }}</button>
        <button v-if="!gameStore.displayName" class="btn" @click="showNameDialog = true">{{ t('name.set') }}</button>
        <button class="btn" @click="router.push('/')">{{ t('common.home') }}</button>
      </div>
    </section>

    <NameDialog :open="showNameDialog" @close="showNameDialog = false" />
  </div>
</template>

<style scoped>
/* The board keeps its full size; a long card pushes it down and the page scrolls */
.tutorial-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* No footer menu here (route meta hideNav), so keep clear of the home indicator ourselves */
  padding: 0 16px calc(12px + env(safe-area-inset-bottom));
  overflow-y: auto;
}
.tutorial-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 12px;
  flex-shrink: 0;
}
.back-btn {
  min-width: 40px;
  padding: 0 10px;
  font-size: 20px;
}
.header-title {
  font-size: 20px;
  font-weight: 800;
  margin: 0;
}
.header-spacer {
  width: 40px;
}
.lesson-card {
  flex-shrink: 0;
  padding: 14px 16px;
}
.lesson-progress {
  margin: 0;
  font-size: 12px;
  font-weight: 800;
  color: var(--text-secondary);
}
.lesson-title {
  margin: 2px 0 6px;
  font-size: 18px;
  font-weight: 800;
}
.lesson-body {
  margin: 0 0 8px;
  font-size: 15px;
  line-height: 1.6;
}
.done-list {
  margin: 0 0 8px;
  padding-left: 1.2em;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
}
.free-status {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.lesson-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.board-area {
  flex-shrink: 0;
  width: min(100%, 480px);
  aspect-ratio: 1;
  margin: 0 auto;
  display: flex;
}
.summary-card {
  overflow-y: auto;
}
.summary-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 8px;
}
</style>
