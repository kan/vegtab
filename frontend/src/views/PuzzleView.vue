<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePuzzleStore } from '@/stores/puzzle';
import { useGameStore } from '@/stores/game';
import type { ItemType } from '@tomado/engine';
import { ALL_ITEM_TYPES, ITEM_LABELS, STICKY_NOTE_COLORS } from '@/utils/constants';
import PuzzleBoard from '@/components/PuzzleBoard.vue';
import ItemIcon from '@/components/ItemIcon.vue';
import RankingModal from '@/components/RankingModal.vue';
import DebugPanel from '@/components/DebugPanel.vue';

const isDev = import.meta.env.DEV;

const store = usePuzzleStore();
const gameStore = useGameStore();
const route = useRoute();
const router = useRouter();
const debugPanel = ref<InstanceType<typeof DebugPanel> | null>(null);
const puzzleBoard = ref<InstanceType<typeof PuzzleBoard> | null>(null);
const scoreRecorded = ref(false);

// --- Item placement phase ---
const preparing = ref(false);
const selectedItem = ref<ItemType | null>(null);
const placedItems = ref<{ row: number; col: number; item: ItemType }[]>([]);

const availableItems = computed<{ type: ItemType; label: string }[]>(() => {
  return ALL_ITEM_TYPES
    .filter(t => gameStore.items[t] > 0)
    .filter(t => !placedItems.value.some(p => p.item === t)) // max 1 per type
    .map(t => ({ type: t, label: ITEM_LABELS[t] }));
});

const hasAnyItems = computed(() => {
  return ALL_ITEM_TYPES.some(t => gameStore.items[t] > 0);
});

const usedItems = computed(() => placedItems.value.length > 0);

// --- Seed status / trial ---
const isTrial = ref(false);
const showUnlockModal = ref(false);
const showNewSeedConfirm = ref(false); // "Play this new seed?" modal
const showAbandonConfirm = ref(false); // "Abandon current game?" modal
const boardLocked = ref(false); // prevent interaction before confirming
const peeking = ref(false); // temporarily hide modal to show board

const seedStatus = computed(() => {
  if (store.seed === undefined) return 'trial_available' as const;
  return gameStore.getSeedStatus(store.seed);
});

function beginGame(seed?: number) {
  store.startGame(seed);
  scoreRecorded.value = false;
  placedItems.value = [];
  selectedItem.value = null;
  showUnlockModal.value = false;
  showNewSeedConfirm.value = false;
  boardLocked.value = false;

  // Determine if this is a trial play
  const actualSeed = store.seed!;
  const status = gameStore.getSeedStatus(actualSeed);
  isTrial.value = status === 'trial_available';

  if (hasAnyItems.value && (status === 'daily_today' || status === 'unlocked')) {
    preparing.value = true;
  } else {
    preparing.value = false;
  }
}

function previewNewSeed() {
  // Generate a random seed just to show the board, but don't commit yet
  const seed = gameStore.randomSeed();
  store.startGame(seed);
  scoreRecorded.value = false;
  isTrial.value = true;
  preparing.value = false;
  showNewSeedConfirm.value = true;
  boardLocked.value = true;
  // Put seed in URL so it's visible and shareable
  router.replace(`/puzzle/${seed}`);
}

function confirmNewSeed() {
  showNewSeedConfirm.value = false;
  boardLocked.value = false;
}

function cancelNewSeed() {
  showNewSeedConfirm.value = false;
  store.gameState = null;
  router.replace('/');
}

function handleRoute(seed: number | undefined) {
  if (seed === undefined && store.gameState && !store.isGameOver && !store.isMoveLimitReached) {
    // Active game exists, user wants new puzzle — ask to abandon
    showAbandonConfirm.value = true;
    return;
  }

  if (seed === undefined && !store.gameState) {
    previewNewSeed();
    return;
  }

  if (!store.gameState || (seed !== undefined && seed !== store.seed)) {
    if (seed !== undefined && !gameStore.canPlay(seed)) {
      showUnlockModal.value = true;
      store.startGame(seed);
      scoreRecorded.value = false;
      isTrial.value = false;
      preparing.value = false;
      return;
    }
    beginGame(seed);
  }
}

function confirmAbandon() {
  showAbandonConfirm.value = false;
  previewNewSeed();
}

function cancelAbandon() {
  showAbandonConfirm.value = false;
  // Restore URL to current seed
  if (store.seed !== undefined) {
    router.replace(`/puzzle/${store.seed}`);
  }
}

onMounted(() => {
  const seedParam = route.params.seed;
  const seed = seedParam ? Number(seedParam) : undefined;
  handleRoute(seed);
});

watch(() => route.params.seed, (newSeedParam) => {
  // Triggered when navigating from /puzzle/123 to /puzzle or /puzzle/456
  const seed = newSeedParam ? Number(newSeedParam) : undefined;
  handleRoute(seed);
});

function selectItemForPlacement(type: ItemType) {
  selectedItem.value = selectedItem.value === type ? null : type;
}

function onPrepBoardClick(row: number, col: number) {
  if (!selectedItem.value) return;
  const board = store.board;
  if (!board) return;
  const cell = board[row]?.[col];
  if (!cell || cell.item) return; // can't place on existing item

  // Remove if already placed at this position
  placedItems.value = placedItems.value.filter(p => !(p.row === row && p.col === col));

  // Place
  store.placeItem({ row, col }, selectedItem.value);
  placedItems.value.push({ row, col, item: selectedItem.value });
  selectedItem.value = null;
}

function undoPlacement(placed: { row: number; col: number; item: ItemType }) {
  // Restore original cell by restarting and replaying remaining placements
  const remaining = placedItems.value.filter(p => p !== placed);
  store.startGame(store.seed);
  placedItems.value = [];
  for (const p of remaining) {
    store.placeItem({ row: p.row, col: p.col }, p.item);
    placedItems.value.push(p);
  }
}

function confirmStart() {
  // Consume items from stock
  for (const p of placedItems.value) {
    gameStore.consumeItem(p.item);
  }
  preparing.value = false;
}

function skipItems() {
  preparing.value = false;
}

// --- Record score when game ends ---
watch(() => store.isGameOver || store.isMoveLimitReached, (ended) => {
  if (ended && !scoreRecorded.value && store.seed !== undefined) {
    scoreRecorded.value = true;
    gameStore.addPlayRecord({
      seed: store.seed,
      mode: store.mode,
      score: store.score,
      moves: store.moveCount,
      usedItems: usedItems.value,
      isTrial: isTrial.value,
    });
    // Mark trial as used
    if (isTrial.value) {
      gameStore.markTrialUsed(store.seed);
      showUnlockModal.value = true;
    }
  }
});

function restart() {
  if (store.seed !== undefined && !gameStore.canRetry(store.seed)) {
    // Can't retry without unlocking
    showUnlockModal.value = true;
    return;
  }
  beginGame(store.seed);
}

function continueAsFree() {
  store.continueAsFree();
}

function doUnlock() {
  if (store.seed === undefined) return;
  if (gameStore.unlockSeed(store.seed)) {
    // Upgrade trial records to non-trial
    for (const r of gameStore.playRecords) {
      if (r.seed === store.seed && r.isTrial) {
        r.isTrial = false;
      }
    }
    isTrial.value = false;
    showUnlockModal.value = false;
  }
}

function giveUpTrial() {
  if (store.seed !== undefined) {
    gameStore.discardTrial(store.seed);
  }
  showUnlockModal.value = false;
  store.gameState = null;
  router.push('/');
}

// --- Top 3 for new seed confirm modal ---
const previewTop3 = computed(() => {
  if (store.seed === undefined) return [];
  return gameStore.getRecordsForSeed(store.seed, 'limited')
    .filter(r => !r.usedItems && !r.isTrial)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((r, i) => ({ rank: i + 1, score: r.score, name: r.playerName || 'Anonymous' }));
});

let peekCleanup: (() => void) | null = null;

function startPeek() {
  peeking.value = true;
  const onUp = () => {
    peeking.value = false;
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    peekCleanup = null;
  };
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  peekCleanup = onUp;
}

onUnmounted(() => {
  if (peekCleanup) {
    window.removeEventListener('pointerup', peekCleanup);
    window.removeEventListener('pointercancel', peekCleanup);
    peekCleanup = null;
  }
});

// --- Board grid for preparation overlay ---
const showRanking = ref(false);

const myBest = computed(() => {
  if (store.seed === undefined) return 0;
  return gameStore.getBestScore(store.seed, store.mode);
});

const BOARD_SIZE = 8;
</script>

<template>
  <div class="puzzle-view">
    <header class="puzzle-header">
      <div class="header-row">
        <div class="seed-label">
          SEED: {{ store.seed }}
          <button class="btn-ranking" @click="showRanking = true" title="Ranking">&#x1F3C6;</button>
        </div>
        <div class="score-area">
          <div class="score-label">SCORE: {{ store.score }}</div>
          <div v-if="myBest > 0" class="best-label">BEST: {{ myBest.toLocaleString() }}</div>
        </div>
      </div>
      <div class="header-row">
        <div class="move-label">
          <template v-if="store.mode === 'limited' && store.remainingMoves !== undefined">
            MOVES: {{ store.remainingMoves }} / {{ store.moveLimit }}
          </template>
          <template v-else>
            MOVE: {{ store.moveCount }}
            <span v-if="store.limitedScore !== null" class="limited-score-ref">(LIMITED: {{ store.limitedScore }} pts)</span>
          </template>
        </div>
        <div class="header-right">
          <span v-if="store.mode === 'limited'" class="mode-badge">LIMITED</span>
          <span v-else class="mode-badge mode-free">FREE</span>
          <span v-if="isTrial" class="trial-badge">TRIAL</span>
          <span v-if="usedItems && !preparing" class="ref-badge">REF</span>
          <button v-if="store.canUndo" class="btn-undo" @click="store.undo()">UNDO</button>
        </div>
      </div>
    </header>

    <div class="board-area">
      <PuzzleBoard ref="puzzleBoard" :debug-panel="debugPanel" />
      <div v-if="boardLocked" class="board-lock" />
    </div>

    <!-- Item Placement Phase -->
    <div v-if="preparing" class="game-over-overlay prep-overlay">
      <div class="prep-panel">
        <h2 class="prep-title">Place Items</h2>
        <p class="prep-desc">Select an item, then tap a cell to place it.<br>Placed items make this a reference record (no ranking).</p>

        <!-- Available items -->
        <div class="prep-items">
          <button
            v-for="ai in availableItems"
            :key="ai.type"
            :class="['prep-item-btn', { selected: selectedItem === ai.type }]"
            @click="selectItemForPlacement(ai.type)"
          >
            <ItemIcon :item="ai.type" :size="28" />
            <span class="prep-item-label">{{ ai.label }}</span>
            <span class="prep-item-stock">x{{ gameStore.items[ai.type] }}</span>
          </button>
        </div>

        <!-- Placed items list -->
        <div v-if="placedItems.length > 0" class="prep-placed">
          <div v-for="(p, i) in placedItems" :key="i" class="prep-placed-row">
            <ItemIcon :item="p.item" :size="20" />
            <span class="prep-placed-pos">({{ p.row + 1 }}, {{ p.col + 1 }})</span>
            <button class="prep-remove-btn" @click="undoPlacement(p)">Remove</button>
          </div>
        </div>

        <!-- Board for placement -->
        <div class="prep-board">
          <div
            v-for="row in BOARD_SIZE"
            :key="row"
            class="prep-board-row"
          >
            <div
              v-for="col in BOARD_SIZE"
              :key="col"
              :class="['prep-cell', { selectable: selectedItem !== null }]"
              @click="onPrepBoardClick(row - 1, col - 1)"
            >
              <template v-if="store.board?.[row - 1]?.[col - 1]">
                <ItemIcon
                  v-if="store.board[row - 1][col - 1].item"
                  :item="store.board[row - 1][col - 1].item!"
                  :size="20"
                />
                <div
                  v-else
                  class="prep-cell-color"
                  :style="{ background: STICKY_NOTE_COLORS[store.board[row - 1][col - 1].color] ?? '#ccc' }"
                />
              </template>
            </div>
          </div>
        </div>

        <div class="prep-actions">
          <button class="btn" @click="confirmStart">
            {{ placedItems.length > 0 ? 'START (Reference)' : 'START' }}
          </button>
          <button class="btn btn-secondary" @click="skipItems">Skip</button>
        </div>
      </div>
    </div>

    <!-- LIMITED mode: moves exhausted → show score + continue option -->
    <div v-else-if="store.isMoveLimitReached" class="game-over-overlay">
      <div class="game-over-card">
        <h2>TIME'S UP!</h2>
        <p class="final-score">{{ store.score }} pts</p>
        <p class="move-info">{{ store.moveLimit }} moves completed</p>
        <p v-if="usedItems" class="ref-note">Reference record (items used)</p>
        <div class="game-over-actions actions-col">
          <button class="btn" @click="restart">RETRY</button>
          <button class="btn btn-continue" @click="continueAsFree">CONTINUE (FREE)</button>
          <button class="btn btn-home" @click="router.push('/')">HOME</button>
        </div>
      </div>
    </div>

    <!-- TRUE game over (stuck in free mode, or stuck before move limit) -->
    <div v-else-if="store.isGameOver" class="game-over-overlay">
      <div class="game-over-card">
        <h2>GAME OVER</h2>
        <p class="final-score">{{ store.score }} pts</p>
        <p v-if="usedItems" class="ref-note">Reference record (items used)</p>
        <div class="game-over-actions actions-col">
          <button class="btn" @click="restart">RETRY</button>
          <button class="btn btn-home" @click="router.push('/')">HOME</button>
        </div>
      </div>
    </div>

    <footer class="puzzle-footer">
      <button class="btn btn-small" @click="restart">RETRY</button>
      <button v-if="isDev" class="btn btn-small btn-debug" @click="debugPanel?.show()">DEBUG</button>
    </footer>

    <!-- New seed confirmation modal -->
    <div v-if="showNewSeedConfirm && !peeking" class="game-over-overlay">
      <div class="game-over-card confirm-card">
        <h2>New Puzzle</h2>
        <p class="confirm-seed">Seed: {{ store.seed }}</p>

        <!-- Top 3 ranking summary -->
        <div v-if="previewTop3.length > 0" class="confirm-ranking">
          <div v-for="entry in previewTop3" :key="entry.rank" class="confirm-rank-row">
            <span class="confirm-rank-num">{{ entry.rank === 1 ? '\u{1F947}' : entry.rank === 2 ? '\u{1F948}' : '\u{1F949}' }}</span>
            <span class="confirm-rank-name">{{ entry.name }}</span>
            <span class="confirm-rank-score">{{ entry.score.toLocaleString() }}</span>
          </div>
        </div>
        <p v-else class="confirm-no-records">No records yet</p>

        <p class="confirm-desc">
          1 free trial play. Unlock (Stamina -1) after to save score &amp; retry.
        </p>
        <div class="game-over-actions actions-col">
          <button class="btn" @click="confirmNewSeed">PLAY</button>
          <button class="btn btn-peek" @pointerdown.prevent="startPeek">Hold to View Board</button>
          <button class="btn btn-secondary" @click="cancelNewSeed">Back to HOME</button>
        </div>
      </div>
    </div>

    <!-- Abandon confirmation modal -->
    <div v-if="showAbandonConfirm" class="game-over-overlay">
      <div class="game-over-card">
        <h2>Abandon Game?</h2>
        <p>Current game will be lost. Start a new puzzle?</p>
        <div class="game-over-actions actions-col">
          <button class="btn" @click="confirmAbandon">New Puzzle</button>
          <button class="btn btn-secondary" @click="cancelAbandon">Continue Playing</button>
        </div>
      </div>
    </div>

    <!-- Unlock modal (trial ended or trial_used) -->
    <div v-if="showUnlockModal" class="game-over-overlay">
      <div class="game-over-card unlock-card">
        <h2>Unlock this Seed?</h2>
        <p class="unlock-desc">
          Unlock to save your score to the ranking and enable unlimited retries.
        </p>
        <p class="unlock-stamina">
          Stamina: {{ gameStore.currentStamina }} / 5
        </p>
        <div class="game-over-actions actions-col">
          <button
            class="btn"
            :disabled="gameStore.currentStamina <= 0"
            @click="doUnlock"
          >
            UNLOCK (Stamina -1)
          </button>
          <button class="btn btn-secondary" @click="giveUpTrial">
            Give Up
          </button>
        </div>
      </div>
    </div>

    <RankingModal :seed="store.seed!" :open="showRanking" @close="showRanking = false" />
    <DebugPanel v-if="isDev" ref="debugPanel" />
  </div>
</template>

<style scoped>
.puzzle-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 12px;
  overflow: hidden;
  position: relative;
}
.puzzle-header {
  margin-bottom: 12px;
}
.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.seed-label {
  font-size: 11px;
  color: #888;
  font-family: monospace;
}
.btn-ranking {
  background: none;
  border: none;
  font-size: 14px;
  cursor: pointer;
  padding: 0 2px;
  vertical-align: middle;
}
.score-area {
  text-align: right;
}
.score-label {
  font-size: 20px;
  font-weight: 700;
  color: #c0392b;
}
.best-label {
  font-size: 11px;
  color: #999;
  font-weight: 600;
}
.move-label {
  font-size: 13px;
  color: #666;
}
.limited-score-ref {
  font-size: 11px;
  color: #999;
  margin-left: 4px;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mode-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 3px;
  background: #c0392b;
  color: #fff;
  letter-spacing: 0.5px;
}
.mode-free {
  background: #27ae60;
}
.trial-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 3px;
  background: #8e44ad;
  color: #fff;
  letter-spacing: 0.5px;
}
.ref-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 3px;
  background: #f39c12;
  color: #fff;
  letter-spacing: 0.5px;
}
.btn-undo {
  padding: 4px 12px;
  border: 1px solid #c0392b;
  background: #fff;
  color: #c0392b;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.board-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.board-lock {
  position: absolute;
  inset: 0;
  z-index: 5;
}
.puzzle-footer {
  display: flex;
  gap: 8px;
  justify-content: center;
  padding: 12px 0 0;
}
.btn {
  padding: 10px 24px;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  background: #c0392b;
  color: #fff;
  font-size: 14px;
}
.btn-secondary {
  background: #7f8c8d;
}
.btn-continue {
  background: #27ae60;
}
.btn-home {
  background: #fff;
  color: #666;
  border: 1px solid #ddd;
}
.btn-small {
  padding: 6px 16px;
  font-size: 12px;
}
.btn-debug {
  background: #2c3e50;
}
.move-info {
  color: #888;
  font-size: 13px;
  margin-bottom: 16px;
}
.ref-note {
  color: #f39c12;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 12px;
}
.game-over-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.game-over-card {
  background: #fff;
  border-radius: 12px;
  padding: 32px;
  text-align: center;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}
.game-over-card h2 {
  font-size: 24px;
  color: #c0392b;
  margin-bottom: 8px;
}
.final-score {
  font-size: 36px;
  font-weight: 700;
  color: #333;
  margin-bottom: 8px;
}
.game-over-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}
.actions-col {
  flex-direction: column;
  gap: 10px;
}
/* Confirm / unlock cards */
.confirm-card, .unlock-card {
  max-width: 300px;
}
.confirm-seed {
  font-size: 11px;
  color: #999;
  font-family: monospace;
  margin: 0 0 10px;
}
.confirm-ranking {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}
.confirm-rank-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: #f8f5f0;
  border-radius: 5px;
  font-size: 13px;
}
.confirm-rank-num {
  width: 24px;
  flex-shrink: 0;
}
.confirm-rank-name {
  flex: 1;
  color: #555;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.confirm-rank-score {
  font-weight: 700;
  color: #333;
}
.confirm-no-records {
  font-size: 12px;
  color: #bbb;
  margin: 0 0 12px;
}
.confirm-desc {
  font-size: 12px;
  color: #888;
  margin: 0 0 14px;
  line-height: 1.4;
}
.btn-peek {
  background: #fff;
  color: #666;
  border: 1px solid #ddd;
  user-select: none;
  -webkit-user-select: none;
}
.unlock-desc {
  font-size: 13px;
  color: #666;
  margin-bottom: 8px;
  line-height: 1.5;
}
.unlock-stamina {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  margin-bottom: 16px;
}

/* Preparation overlay */
.prep-overlay {
  overflow-y: auto;
}
.prep-panel {
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  width: 340px;
  max-width: 95vw;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}
.prep-title {
  font-size: 18px;
  font-weight: 700;
  color: #333;
  margin: 0 0 4px;
  text-align: center;
}
.prep-desc {
  font-size: 11px;
  color: #999;
  text-align: center;
  margin: 0 0 12px;
  line-height: 1.5;
}
.prep-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.prep-item-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: #f8f5f0;
  border: 2px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.prep-item-btn.selected {
  border-color: #c0392b;
  background: #fef0ef;
}
.prep-item-label {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: #333;
}
.prep-item-stock {
  font-size: 12px;
  color: #999;
}
.prep-placed {
  margin-bottom: 12px;
}
.prep-placed-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
  color: #666;
}
.prep-placed-pos {
  flex: 1;
}
.prep-remove-btn {
  background: none;
  border: none;
  color: #c0392b;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.prep-board {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-bottom: 12px;
  background: #e8e0d4;
  border-radius: 6px;
  overflow: hidden;
  padding: 1px;
}
.prep-board-row {
  display: flex;
  gap: 1px;
}
.prep-cell {
  width: calc((100% - 7px) / 8);
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f8f5f0;
  border-radius: 2px;
}
.prep-cell.selectable {
  cursor: pointer;
}
.prep-cell.selectable:hover {
  background: #f0ebe3;
}
.prep-cell-color {
  width: 70%;
  height: 70%;
  border-radius: 3px;
}
.prep-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
}
</style>
