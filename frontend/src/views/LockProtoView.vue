<script setup lang="ts">
import { ref, computed, provide } from 'vue';
import { useRouter } from 'vue-router';
import { initializeGame, generateDailySeed, countLocks, countLockLayers } from '@vegtab/engine';
import PuzzleBoard from '@/components/PuzzleBoard.vue';
import { useLockProtoPuzzleStore, PUZZLE_STORE_KEY } from '@/stores/puzzle';
import { playSE, vibrate } from '@/sound';
import { todayJST } from '@/utils/date';

/**
 * 鎖のモードの試作ページ（#107、開発時だけ開ける /proto/lock）。日付から作ったシードの盤に鎖を置いて遊ぶ。
 * 記録は送らない。文言は試作なので i18n にしていない
 */
const router = useRouter();
const store = useLockProtoPuzzleStore();
provide(PUZZLE_STORE_KEY, store);

const date = ref(todayJST());
const lockCount = ref(12);
const doubleCount = ref(4);
/** Bumped on every (re)start to remount the board, so its animation state starts clean */
const attempt = ref(0);

const seed = computed(() => generateDailySeed(date.value));
const locks = computed(() => store.gameState ? countLocks(store.gameState.board) : 0);
const layers = computed(() => store.gameState ? countLockLayers(store.gameState.board) : 0);
const status = computed(() => {
  if (store.isCleared) return `クリア！ ${store.moveCount} 手`;
  if (store.isGameOver) return '詰み（動かせる手がない）';
  return `残りの鎖 ${locks.value} 個（${layers.value} 段）・${store.moveCount} 手`;
});

function start() {
  const count = Math.max(0, Math.min(40, Math.floor(lockCount.value)));
  const double = Math.max(0, Math.min(count, Math.floor(doubleCount.value)));
  store.restoreState(seed.value, initializeGame(seed.value, { locks: { count, double } }), []);
  attempt.value++;
}

function shiftDay(days: number) {
  const d = new Date(`${date.value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  date.value = d.toISOString().slice(0, 10);
  start();
}

function onSettled() {
  if (store.isCleared) { playSE('complete'); vibrate(20); }
}

start();
</script>

<template>
  <div class="proto-view">
    <header class="proto-header">
      <button class="btn btn-sm back-btn" aria-label="HOME" @click="router.push('/')">&larr;</button>
      <h1 class="header-title">鎖のモード（試作）</h1>
      <span class="header-spacer" />
    </header>

    <section class="card proto-card">
      <p class="rule">
        鎖の付いた野菜は動かせません。同じ色の野菜を 2 つ運んでマッチに入れると、鎖が 1 段外れます。
        アイテムの範囲に入っても 1 段外れます。全部の鎖を外すとクリア。
      </p>
      <!-- 演出の途中で盤を作り直すと、前の盤の演出の結果が新しい盤を上書きするので、その間は止める -->
      <fieldset class="controls" :disabled="store.animating">
        <label class="field">
          <span>日付</span>
          <span class="date-row">
            <button class="btn btn-sm" @click="shiftDay(-1)">&lsaquo;</button>
            <input v-model="date" type="date" @change="start" />
            <button class="btn btn-sm" @click="shiftDay(1)">&rsaquo;</button>
          </span>
        </label>
        <label class="field">
          <span>鎖の数</span>
          <input v-model.number="lockCount" type="number" min="0" max="40" @change="start" />
        </label>
        <label class="field">
          <span>うち 2 段</span>
          <input v-model.number="doubleCount" type="number" min="0" :max="lockCount" @change="start" />
        </label>
      </fieldset>
      <p class="status" aria-live="polite">{{ status }}</p>
      <div class="actions">
        <span class="seed">seed {{ seed }}</span>
        <button class="btn" :disabled="store.animating" @click="start">やり直す</button>
      </div>
    </section>

    <div class="board-area">
      <PuzzleBoard :key="attempt" @settled="onSettled" />
    </div>
  </div>
</template>

<style scoped>
.proto-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 16px calc(12px + env(safe-area-inset-bottom));
  overflow-y: auto;
}
.proto-header {
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
.proto-card {
  flex-shrink: 0;
  padding: 12px 16px;
}
.rule {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
}
.controls {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-bottom: 8px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  font-weight: 700;
}
.field input[type='number'] {
  width: 64px;
}
.date-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.status {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.seed {
  font-size: 11px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.board-area {
  flex-shrink: 0;
  width: min(100%, 480px);
  aspect-ratio: 1;
  margin: 0 auto;
  display: flex;
}
</style>
