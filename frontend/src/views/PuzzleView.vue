<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { usePuzzleStore } from '@/stores/puzzle';
import { useGameStore } from '@/stores/game';
import { playSE, vibrate, startBGM, stopBGM, useSound } from '@/sound';
import PuzzleBoard from '@/components/PuzzleBoard.vue';
import RankingModal from '@/components/RankingModal.vue';
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
  | 'abandonConfirm'   // "Abandon current game?" modal
  ;

const viewPhase = ref<ViewPhase>('playing');

function beginGame(seed?: number) {
  store.startGame(seed);
  startBGM();
  scoreRecorded.value = false;
  viewPhase.value = 'playing';
}

function handleRoute(seed: number | undefined) {
  if (seed === undefined && store.gameState && !store.isGameOver) {
    // Active game exists, user wants new puzzle -- ask to abandon
    viewPhase.value = 'abandonConfirm';
    return;
  }

  if (seed === undefined && !store.gameState) {
    // No seed in URL, no active game -- generate random seed and start
    const newSeed = gameStore.randomSeed();
    router.replace(`/puzzle/${newSeed}`);
    beginGame(newSeed);
    return;
  }

  if (!store.gameState || (seed !== undefined && seed !== store.seed)) {
    beginGame(seed);
  }
}

function confirmAbandon() {
  const newSeed = gameStore.randomSeed();
  router.replace(`/puzzle/${newSeed}`);
  beginGame(newSeed);
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

// --- Record score when game ends ---
watch(() => store.isGameOver, (ended) => {
  if (ended && !scoreRecorded.value && store.seed !== undefined) {
    stopBGM();
    playSE('game_over'); vibrate([50, 50, 100]);
    scoreRecorded.value = true;
    gameStore.recordGameEnd({
      seed: store.seed,
      mode: 'limited',
      score: store.score,
      moves: store.moveCount,
    });
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
  const code = shareCode.value ?? `#${store.seed}`;
  const url = shareUrl.value ?? '';
  const text = `Tomado Puzzle ${code} | ${store.moveCount}moves ${store.score.toLocaleString()}pts`;
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
  beginGame(store.seed);
}

onUnmounted(() => {
  stopBGM();
});

// --- Board grid for preparation overlay ---
const showRanking = ref(false);

const myBest = computed(() => {
  if (store.seed === undefined) return 0;
  return gameStore.getBestScore(store.seed, 'limited');
});

const { seEnabled, bgmEnabled, toggleSE, toggleBGM } = useSound();
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
          <template v-if="store.remainingMoves !== undefined">
            {{ t('puzzle.movesRemaining', { remaining: store.remainingMoves, limit: store.moveLimit }) }}
          </template>
          <template v-else>
            {{ t('puzzle.moveCount', { count: store.moveCount }) }}
          </template>
        </div>
      </div>
    </header>

    <div class="board-area">
      <PuzzleBoard ref="puzzleBoard" :debug-panel="debugPanel" />
    </div>

    <!-- Game over overlay -->
    <div v-if="store.isGameOver" class="game-over-overlay">
      <div class="game-over-card">
        <h2>{{ t('puzzle.gameOver') }}</h2>
        <p class="final-score">{{ t('puzzle.pts', { score: store.score }) }}</p>
        <p class="move-info">{{ t('puzzle.moveCount', { count: store.moveCount }) }}</p>
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
.board-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
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
</style>
