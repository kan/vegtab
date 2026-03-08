<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { usePuzzleStore } from '@/stores/puzzle';
import { useGameStore } from '@/stores/game';
import type { ItemType } from '@tomado/engine';
import { ALL_ITEM_TYPES, ITEM_LABELS, STICKY_NOTE_COLORS } from '@/utils/constants';
import { playSE, vibrate, startBGM, stopBGM, useSound } from '@/sound';
import PuzzleBoard from '@/components/PuzzleBoard.vue';
import ItemIcon from '@/components/ItemIcon.vue';
import RankingModal from '@/components/RankingModal.vue';
import QrCode from '@/components/QrCode.vue';
import DebugPanel from '@/components/DebugPanel.vue';

const isDev = import.meta.env.DEV;
const { t } = useI18n();

const store = usePuzzleStore();
const gameStore = useGameStore();
const route = useRoute();
const router = useRouter();
const debugPanel = ref<InstanceType<typeof DebugPanel> | null>(null);
const puzzleBoard = ref<InstanceType<typeof PuzzleBoard> | null>(null);
const scoreRecorded = ref(false);

// --- View phase (exclusive modal/overlay states) ---
type ViewPhase =
  | 'playing'          // normal gameplay
  | 'preparing'        // item placement before game start
  | 'newSeedConfirm'   // "Play this new seed?" modal
  | 'newSeedPeeking'   // temporarily showing board during newSeedConfirm
  | 'abandonConfirm'   // "Abandon current game?" modal
  | 'unlock'           // "Unlock this seed?" modal after trial
  ;

const viewPhase = ref<ViewPhase>('playing');
const boardLocked = computed(() => viewPhase.value === 'newSeedConfirm' || viewPhase.value === 'newSeedPeeking');

// --- Item placement phase ---
const selectedItem = ref<ItemType | null>(null);
const placedItems = ref<{ row: number; col: number; item: ItemType }[]>([]);

const availableItems = computed<{ type: ItemType; label: string }[]>(() => {
  return ALL_ITEM_TYPES
    .filter(it => gameStore.items[it] > 0)
    .filter(it => !placedItems.value.some(p => p.item === it)) // max 1 per type
    .map(it => ({ type: it, label: ITEM_LABELS[it] }));
});

const hasAnyItems = computed(() => {
  return ALL_ITEM_TYPES.some(it => gameStore.items[it] > 0);
});

const usedItems = computed(() => placedItems.value.length > 0);

// --- Seed status / trial ---
const isTrial = ref(false);

const seedStatus = computed(() => {
  if (store.seed === undefined) return 'trial_available' as const;
  return gameStore.getSeedStatus(store.seed);
});

function beginGame(seed?: number) {
  store.startGame(seed);
  startBGM();
  scoreRecorded.value = false;
  placedItems.value = [];
  selectedItem.value = null;

  // Determine if this is a trial play
  const actualSeed = store.seed!;
  const status = gameStore.getSeedStatus(actualSeed);
  isTrial.value = status === 'trial_available';

  if (hasAnyItems.value && (status === 'daily_today' || status === 'unlocked')) {
    viewPhase.value = 'preparing';
  } else {
    viewPhase.value = 'playing';
  }
}

function previewNewSeed() {
  // Generate a random seed just to show the board, but don't commit yet
  const seed = gameStore.randomSeed();
  store.startGame(seed);
  scoreRecorded.value = false;
  isTrial.value = true;
  viewPhase.value = 'newSeedConfirm';
  // Put seed in URL so it's visible and shareable
  router.replace(`/puzzle/${seed}`);
}

function confirmNewSeed() {
  viewPhase.value = 'playing';
}

function cancelNewSeed() {
  viewPhase.value = 'playing';
  store.gameState = null;
  router.replace('/');
}

function handleRoute(seed: number | undefined) {
  if (seed === undefined && store.gameState && !store.isGameOver && !store.isMoveLimitReached) {
    // Active game exists, user wants new puzzle — ask to abandon
    viewPhase.value = 'abandonConfirm';
    return;
  }

  if (seed === undefined && !store.gameState) {
    previewNewSeed();
    return;
  }

  if (!store.gameState || (seed !== undefined && seed !== store.seed)) {
    if (seed !== undefined && !gameStore.canPlay(seed)) {
      viewPhase.value = 'unlock';
      store.startGame(seed);
      scoreRecorded.value = false;
      isTrial.value = false;
      return;
    }
    beginGame(seed);
  }
}

function confirmAbandon() {
  previewNewSeed();
}

function cancelAbandon() {
  viewPhase.value = 'playing';
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
  viewPhase.value = 'playing';
}

function skipItems() {
  viewPhase.value = 'playing';
}

// --- Record score when game ends ---
watch(() => store.isGameOver || store.isMoveLimitReached, (ended) => {
  if (ended && !scoreRecorded.value && store.seed !== undefined) {
    stopBGM();
    if (store.isMoveLimitReached && !store.isGameOver) {
      playSE('complete'); vibrate([30, 30, 60]);
    } else {
      playSE('game_over'); vibrate([50, 50, 100]);
    }
    scoreRecorded.value = true;
    const wasTrial = gameStore.recordGameEnd({
      seed: store.seed,
      mode: store.mode,
      score: store.score,
      moves: store.moveCount,
      usedItems: usedItems.value,
      isTrial: isTrial.value,
    });
    if (wasTrial) {
      viewPhase.value = 'unlock';
    }
    // Eagerly fetch share code for score screen
    gameStore.getShareCode(store.seed!).then(code => { shareCode.value = code; }).catch(() => {});
  }
});

// --- Share ---
const shareToast = ref(false);
const shareCode = ref<string | null>(null);
const shareUrl = computed(() => shareCode.value ? `${location.origin}/s/${shareCode.value}` : null);

async function shareScore() {
  if (store.seed === undefined) return;
  // Get or create share code
  if (!shareCode.value) {
    shareCode.value = await gameStore.getShareCode(store.seed);
  }
  const mode = store.mode === 'limited' ? 'LIMITED' : 'FREE';
  const code = shareCode.value ?? `#${store.seed}`;
  const url = shareUrl.value ?? '';
  const text = `Tomado Puzzle ${code} | ${mode} ${store.moveCount}moves ${store.score.toLocaleString()}pts`;
  const shareData: ShareData = { text };
  if (url) shareData.url = url;
  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch { /* user cancelled */ }
  } else {
    await navigator.clipboard.writeText(url ? `${text}\n${url}` : text);
    shareToast.value = true;
    setTimeout(() => { shareToast.value = false; }, 2000);
  }
}

function restart() {
  if (store.seed !== undefined && !gameStore.canRetry(store.seed)) {
    // Can't retry without unlocking
    viewPhase.value = 'unlock';
    return;
  }
  beginGame(store.seed);
}

function continueAsFree() {
  store.continueAsFree();
}

function doUnlock() {
  if (store.seed === undefined) return;
  if (gameStore.confirmUnlock(store.seed)) {
    isTrial.value = false;
    viewPhase.value = 'playing';
  }
}

function giveUpTrial() {
  if (store.seed !== undefined) {
    gameStore.discardTrial(store.seed);
  }
  viewPhase.value = 'playing';
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
  viewPhase.value = 'newSeedPeeking';
  const onUp = () => {
    viewPhase.value = 'newSeedConfirm';
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    peekCleanup = null;
  };
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  peekCleanup = onUp;
}

onUnmounted(() => {
  stopBGM();
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

const { seEnabled, bgmEnabled, toggleSE, toggleBGM } = useSound();

const BOARD_SIZE = 8;
</script>

<template>
  <div class="puzzle-view">
    <header class="puzzle-header">
      <div class="header-row">
        <div class="seed-label">
          {{ t('puzzle.seed', { seed: store.seed }) }}
          <button class="btn-ranking" @click="showRanking = true" :title="t('common.ranking')">&#x1F3C6;</button>
        </div>
        <div class="score-area">
          <div class="score-label">{{ t('puzzle.score', { score: store.score }) }}</div>
          <div v-if="myBest > 0" class="best-label">{{ t('puzzle.best', { score: myBest.toLocaleString() }) }}</div>
        </div>
      </div>
      <div class="header-row">
        <div class="move-label">
          <template v-if="store.mode === 'limited' && store.remainingMoves !== undefined">
            {{ t('puzzle.movesRemaining', { remaining: store.remainingMoves, limit: store.moveLimit }) }}
          </template>
          <template v-else>
            {{ t('puzzle.moveCount', { count: store.moveCount }) }}
            <span v-if="store.limitedScore !== null" class="limited-score-ref">{{ t('puzzle.limitedScore', { score: store.limitedScore }) }}</span>
          </template>
        </div>
        <div class="header-right">
          <span v-if="store.mode === 'limited'" class="mode-badge">{{ t('puzzle.limited') }}</span>
          <span v-else class="mode-badge mode-free">{{ t('puzzle.free') }}</span>
          <span v-if="isTrial" class="trial-badge">{{ t('puzzle.trial') }}</span>
          <span v-if="usedItems && viewPhase !== 'preparing'" class="ref-badge">{{ t('puzzle.ref') }}</span>
          <button v-if="store.canUndo" class="btn-undo" @click="playSE('undo'); store.undo()">{{ t('puzzle.undoButton') }}</button>
        </div>
      </div>
    </header>

    <div class="board-area">
      <PuzzleBoard ref="puzzleBoard" :debug-panel="debugPanel" />
      <div v-if="boardLocked" class="board-lock" />
    </div>

    <!-- Item Placement Phase -->
    <div v-if="viewPhase === 'preparing'" class="game-over-overlay prep-overlay">
      <div class="prep-panel">
        <h2 class="prep-title">{{ t('puzzle.placeItems') }}</h2>
        <p class="prep-desc">{{ t('puzzle.placeItemsDesc1') }}<br>{{ t('puzzle.placeItemsDesc2') }}</p>

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
            <button class="prep-remove-btn" @click="undoPlacement(p)">{{ t('puzzle.remove') }}</button>
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
                  v-if="(store.board as any)[row - 1][col - 1].item"
                  :item="(store.board as any)[row - 1][col - 1].item"
                  :size="20"
                />
                <div
                  v-else
                  class="prep-cell-color"
                  :style="{ background: STICKY_NOTE_COLORS[(store.board as any)[row - 1][col - 1].color] ?? '#ccc' }"
                />
              </template>
            </div>
          </div>
        </div>

        <div class="prep-actions">
          <button class="btn" @click="confirmStart">
            {{ placedItems.length > 0 ? t('puzzle.startRef') : t('puzzle.start') }}
          </button>
          <button class="btn btn-secondary" @click="skipItems">{{ t('common.skip') }}</button>
        </div>
      </div>
    </div>

    <!-- LIMITED mode: moves exhausted → show score + continue option -->
    <div v-else-if="store.isMoveLimitReached" class="game-over-overlay">
      <div class="game-over-card">
        <h2>{{ t('puzzle.timesUp') }}</h2>
        <p class="final-score">{{ t('puzzle.pts', { score: store.score }) }}</p>
        <p class="move-info">{{ t('puzzle.movesCompleted', { count: store.moveLimit }) }}</p>
        <p v-if="usedItems" class="ref-note">{{ t('puzzle.refNote') }}</p>
        <div v-if="shareCode" class="share-info">
          <QrCode :value="shareUrl!" :size="100" />
          <span class="share-code-label">{{ shareCode }}</span>
        </div>
        <div class="game-over-actions actions-col">
          <button class="btn" @click="restart">{{ t('common.retry') }}</button>
          <button class="btn btn-continue" @click="continueAsFree">{{ t('puzzle.continueFree') }}</button>
          <button class="btn btn-share" @click="shareScore">{{ t('common.share') }}</button>
          <button class="btn btn-home" @click="router.push('/')">{{ t('common.home') }}</button>
        </div>
      </div>
    </div>

    <!-- TRUE game over (stuck in free mode, or stuck before move limit) -->
    <div v-else-if="store.isGameOver" class="game-over-overlay">
      <div class="game-over-card">
        <h2>{{ t('puzzle.gameOver') }}</h2>
        <p class="final-score">{{ t('puzzle.pts', { score: store.score }) }}</p>
        <p v-if="usedItems" class="ref-note">{{ t('puzzle.refNote') }}</p>
        <div v-if="shareCode" class="share-info">
          <QrCode :value="shareUrl!" :size="100" />
          <span class="share-code-label">{{ shareCode }}</span>
        </div>
        <div class="game-over-actions actions-col">
          <button class="btn" @click="restart">{{ t('common.retry') }}</button>
          <button class="btn btn-share" @click="shareScore">{{ t('common.share') }}</button>
          <button class="btn btn-home" @click="router.push('/')">{{ t('common.home') }}</button>
        </div>
      </div>
    </div>

    <footer class="puzzle-footer">
      <div class="footer-sound">
        <button :class="['sound-toggle', { off: !seEnabled }]" @click="toggleSE" :title="t('home.soundSE')">
          {{ seEnabled ? '🔊' : '🔇' }}
        </button>
        <button :class="['sound-toggle', { off: !bgmEnabled }]" @click="toggleBGM" :title="t('home.soundBGM')">
          🎵
        </button>
      </div>
      <button class="btn btn-small" @click="restart">{{ t('common.retry') }}</button>
      <button v-if="isDev" class="btn btn-small btn-debug" @click="debugPanel?.show()">{{ t('puzzle.debug') }}</button>
    </footer>

    <!-- Share toast -->
    <div v-if="shareToast" class="share-toast">{{ t('common.copiedToClipboard') }}</div>

    <!-- New seed confirmation modal -->
    <div v-if="viewPhase === 'newSeedConfirm'" class="game-over-overlay">
      <div class="game-over-card confirm-card">
        <h2>{{ t('home.newPuzzle') }}</h2>
        <p class="confirm-seed">{{ t('puzzle.seed', { seed: store.seed }) }}</p>

        <!-- Top 3 ranking summary -->
        <div v-if="previewTop3.length > 0" class="confirm-ranking">
          <div v-for="entry in previewTop3" :key="entry.rank" class="confirm-rank-row">
            <span class="confirm-rank-num">{{ entry.rank === 1 ? '\u{1F947}' : entry.rank === 2 ? '\u{1F948}' : '\u{1F949}' }}</span>
            <span class="confirm-rank-name">{{ entry.name }}</span>
            <span class="confirm-rank-score">{{ entry.score.toLocaleString() }}</span>
          </div>
        </div>
        <p v-else class="confirm-no-records">{{ t('common.noRecords') }}</p>

        <p class="confirm-desc">
          {{ t('puzzle.trialInfo') }}
        </p>
        <div class="game-over-actions actions-col">
          <button class="btn" @click="confirmNewSeed">{{ t('common.play') }}</button>
          <button class="btn btn-peek" @pointerdown.prevent="startPeek">{{ t('puzzle.holdToView') }}</button>
          <button class="btn btn-secondary" @click="cancelNewSeed">{{ t('puzzle.backToHome') }}</button>
        </div>
      </div>
    </div>

    <!-- Abandon confirmation modal -->
    <div v-if="viewPhase === 'abandonConfirm'" class="game-over-overlay">
      <div class="game-over-card">
        <h2>{{ t('puzzle.abandonTitle') }}</h2>
        <p>{{ t('puzzle.abandonMessage') }}</p>
        <div class="game-over-actions actions-col">
          <button class="btn" @click="confirmAbandon">{{ t('home.newPuzzle') }}</button>
          <button class="btn btn-secondary" @click="cancelAbandon">{{ t('puzzle.continuePlaying') }}</button>
        </div>
      </div>
    </div>

    <!-- Unlock modal (trial ended or trial_used) -->
    <div v-if="viewPhase === 'unlock'" class="game-over-overlay">
      <div class="game-over-card unlock-card">
        <h2>{{ t('puzzle.unlockTitle') }}</h2>
        <p class="unlock-desc">
          {{ t('puzzle.unlockMessage') }}
        </p>
        <p class="unlock-stamina">
          {{ t('puzzle.staminaDisplay', { current: gameStore.currentStamina, max: 5 }) }}
        </p>
        <div class="game-over-actions actions-col">
          <button
            class="btn"
            :disabled="gameStore.currentStamina <= 0"
            @click="doUnlock"
          >
            {{ t('puzzle.unlockButton') }}
          </button>
          <button class="btn btn-secondary" @click="giveUpTrial">
            {{ t('puzzle.giveUp') }}
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
  color: var(--text-tertiary);
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
  color: var(--brand);
}
.best-label {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 600;
}
.move-label {
  font-size: 13px;
  color: var(--text-secondary);
}
.limited-score-ref {
  font-size: 11px;
  color: var(--text-muted);
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
  background: var(--brand);
  color: #fff;
  letter-spacing: 0.5px;
}
.mode-free {
  background: var(--success);
}
.trial-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--purple);
  color: #fff;
  letter-spacing: 0.5px;
}
.ref-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--warning);
  color: #fff;
  letter-spacing: 0.5px;
}
.btn-undo {
  padding: 4px 12px;
  border: 1px solid var(--brand);
  background: var(--bg-card);
  color: var(--brand);
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
  align-items: center;
  padding: 12px 0 0;
}
.footer-sound {
  display: flex;
  gap: 4px;
}
.sound-toggle {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-card);
  font-size: 14px;
  cursor: pointer;
}
.sound-toggle.off {
  opacity: 0.4;
}
.btn {
  padding: 10px 24px;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  background: var(--brand);
  color: #fff;
  font-size: 14px;
}
.btn-secondary {
  background: var(--secondary);
}
.btn-continue {
  background: var(--success);
}
.btn-share {
  background: var(--info);
}
.btn-home {
  background: var(--bg-card);
  color: var(--text-secondary);
  border: 1px solid var(--border);
}
.share-toast {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  padding: 8px 20px;
  border-radius: 20px;
  font-size: 13px;
  z-index: 2000;
}
.btn-small {
  padding: 6px 16px;
  font-size: 12px;
}
.btn-debug {
  background: var(--slate);
}
.move-info {
  color: var(--text-tertiary);
  font-size: 13px;
  margin-bottom: 16px;
}
.ref-note {
  color: var(--warning);
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 12px;
}
.share-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin-bottom: 12px;
}
.share-code-label {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: var(--text-secondary);
}
.game-over-overlay {
  position: absolute;
  inset: 0;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.game-over-card {
  background: var(--bg-card);
  border-radius: 12px;
  padding: 32px;
  text-align: center;
  box-shadow: var(--shadow-modal);
}
.game-over-card h2 {
  font-size: 24px;
  color: var(--brand);
  margin-bottom: 8px;
}
.final-score {
  font-size: 36px;
  font-weight: 700;
  color: var(--text-primary);
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
  color: var(--text-muted);
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
  background: var(--bg-card-alt);
  border-radius: 5px;
  font-size: 13px;
}
.confirm-rank-num {
  width: 24px;
  flex-shrink: 0;
}
.confirm-rank-name {
  flex: 1;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.confirm-rank-score {
  font-weight: 700;
  color: var(--text-primary);
}
.confirm-no-records {
  font-size: 12px;
  color: var(--text-disabled);
  margin: 0 0 12px;
}
.confirm-desc {
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 0 0 14px;
  line-height: 1.4;
}
.btn-peek {
  background: var(--bg-card);
  color: var(--text-secondary);
  border: 1px solid var(--border);
  user-select: none;
  -webkit-user-select: none;
}
.unlock-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 8px;
  line-height: 1.5;
}
.unlock-stamina {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 16px;
}

/* Preparation overlay */
.prep-overlay {
  overflow-y: auto;
}
.prep-panel {
  background: var(--bg-card);
  border-radius: 12px;
  padding: 20px;
  width: 340px;
  max-width: 95vw;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: var(--shadow-modal);
}
.prep-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 4px;
  text-align: center;
}
.prep-desc {
  font-size: 11px;
  color: var(--text-muted);
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
  background: var(--bg-card-alt);
  border: 2px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.prep-item-btn.selected {
  border-color: var(--brand);
  background: var(--brand-light);
}
.prep-item-label {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.prep-item-stock {
  font-size: 12px;
  color: var(--text-muted);
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
  color: var(--text-secondary);
}
.prep-placed-pos {
  flex: 1;
}
.prep-remove-btn {
  background: none;
  border: none;
  color: var(--brand);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.prep-board {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-bottom: 12px;
  background: var(--border-alt);
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
  background: var(--bg-card-alt);
  border-radius: 2px;
}
.prep-cell.selectable {
  cursor: pointer;
}
.prep-cell.selectable:hover {
  background: var(--bg-hover);
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
