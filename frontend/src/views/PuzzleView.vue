<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { usePuzzleStore } from '@/stores/puzzle';
import { useGameStore, type GameMode } from '@/stores/game';
import { playSE, vibrate, startBGM, stopBGM, useSound } from '@/sound';
import PuzzleBoard from '@/components/PuzzleBoard.vue';
import RankingModal from '@/components/RankingModal.vue';
import ModeSelector from '@/components/ModeSelector.vue';
import SurvivalGauge from '@/components/SurvivalGauge.vue';
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

// --- View phase ---
type ViewPhase = 'modeSelect' | 'playing';
const viewPhase = ref<ViewPhase>('modeSelect');
const selectedMode = ref<GameMode>('sprint');

function beginGame(seed: number, mode: GameMode) {
  selectedMode.value = mode;
  store.startGame(seed, mode);
  startBGM();
  scoreRecorded.value = false;
  viewPhase.value = 'playing';
}

function handleRoute() {
  const seedParam = route.params.seed;
  const seed = seedParam ? Number(seedParam) : undefined;
  const modeQuery = route.query.mode as GameMode | undefined;

  if (!seed) {
    // No seed — go home
    router.replace('/');
    return;
  }

  if (modeQuery && ['sprint', 'clear', 'survival'].includes(modeQuery)) {
    // Mode specified in URL — start immediately
    beginGame(seed, modeQuery);
    return;
  }

  // Show mode selector
  viewPhase.value = 'modeSelect';
}

function onModeSelect(mode: GameMode) {
  const seedParam = route.params.seed;
  const seed = seedParam ? Number(seedParam) : gameStore.generateDailySeed();
  router.replace(`/puzzle/${seed}?mode=${mode}`);
  beginGame(seed, mode);
}

onMounted(() => {
  handleRoute();
});

watch(() => [route.params.seed, route.query.mode], () => {
  handleRoute();
});

// --- Record score when game ends ---
watch(() => store.isGameOver, (ended) => {
  if (ended && !scoreRecorded.value && store.seed !== undefined) {
    stopBGM();
    const isPositiveEnd = (selectedMode.value === 'sprint'
      && store.moveLimit !== undefined
      && store.moveCount >= store.moveLimit)
      || store.isCleared === true;
    playSE(isPositiveEnd ? 'complete' : 'game_over');
    vibrate(isPositiveEnd ? [30, 30, 50] : [50, 50, 100]);
    scoreRecorded.value = true;
    gameStore.addPlayRecord({
      seed: store.seed,
      mode: selectedMode.value,
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
  if (!shareCode.value) {
    shareCode.value = await gameStore.getShareCode(store.seed);
  }
  const code = shareCode.value ?? `#${store.seed}`;
  const url = shareUrl.value ?? '';
  const modeLabel = t(`mode.${selectedMode.value}`);
  const text = selectedMode.value === 'clear'
    ? `Tomado ${modeLabel} ${code} | ${store.isCleared ? 'CLEARED' : 'FAILED'} ${store.moveCount}${t('mode.moves')}`
    : `Tomado ${modeLabel} ${code} | ${store.moveCount}${t('mode.moves')} ${store.score.toLocaleString()}pts`;
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
  beginGame(store.seed, selectedMode.value);
}

onUnmounted(() => {
  stopBGM();
});

// --- Ranking ---
const showRanking = ref(false);

const myBest = computed(() => {
  if (store.seed === undefined) return 0;
  return gameStore.getBestScore(store.seed, selectedMode.value);
});

const { seEnabled, bgmEnabled, toggleSE, toggleBGM } = useSound();

// --- Game over display ---
const gameOverTitle = computed(() => {
  if (selectedMode.value === 'clear') {
    return store.isCleared ? t('mode.cleared') : t('mode.failed');
  }
  if (selectedMode.value === 'sprint'
    && store.moveLimit !== undefined
    && store.moveCount >= store.moveLimit) {
    return t('mode.turnOver');
  }
  return t('puzzle.gameOver');
});

const gameOverScore = computed(() => {
  if (selectedMode.value === 'clear') {
    return store.isCleared
      ? t('mode.clearMoves', { count: store.moveCount })
      : t('mode.obstaclesLeft', { count: store.obstacleCount });
  }
  if (selectedMode.value === 'survival') {
    return t('mode.survivalResult', { moves: store.moveCount, score: store.score.toLocaleString() });
  }
  return t('puzzle.pts', { score: store.score });
});
</script>

<template>
  <div class="puzzle-view">
    <!-- Mode select overlay -->
    <ModeSelector
      v-if="viewPhase === 'modeSelect'"
      :seed="Number(route.params.seed) || 0"
      :open="true"
      @select="onModeSelect"
      @close="router.push('/')"
    />

    <template v-if="viewPhase === 'playing'">
      <header class="puzzle-header">
        <div class="header-row">
          <div class="seed-label">
            {{ t('puzzle.seed', { seed: store.seed }) }}
            <span class="mode-badge">{{ t(`mode.${selectedMode}`) }}</span>
            <button class="btn-ranking" @click="showRanking = true" :title="t('common.ranking')">&#x1F3C6;</button>
          </div>
          <div class="score-area">
            <template v-if="selectedMode === 'clear'">
              <div class="score-label">{{ t('mode.obstacles', { count: store.obstacleCount }) }}</div>
            </template>
            <template v-else>
              <div class="score-label">{{ t('puzzle.score', { score: store.score }) }}</div>
              <div v-if="myBest > 0" class="best-label">{{ t('puzzle.best', { score: myBest.toLocaleString() }) }}</div>
            </template>
          </div>
        </div>
        <div class="header-row">
          <div class="move-label">
            <template v-if="selectedMode === 'sprint' && store.remainingMoves !== undefined">
              {{ t('puzzle.movesRemaining', { remaining: store.remainingMoves, limit: store.moveLimit }) }}
            </template>
            <template v-else>
              {{ t('puzzle.moveCount', { count: store.moveCount }) }}
            </template>
          </div>
        </div>
        <!-- Survival gauge -->
        <div v-if="selectedMode === 'survival' && store.quotaTarget !== undefined && store.movesUntilCheck !== undefined" class="header-row">
          <SurvivalGauge
            :current-score="store.segmentScore"
            :quota="store.quotaTarget"
            :moves-until-check="store.movesUntilCheck"
          />
        </div>
      </header>

      <div class="board-area">
        <PuzzleBoard ref="puzzleBoard" :debug-panel="debugPanel" />
      </div>

      <!-- Game over overlay -->
      <div v-if="store.isGameOver" class="game-over-overlay">
        <div class="game-over-card">
          <h2>{{ gameOverTitle }}</h2>
          <p class="final-score">{{ gameOverScore }}</p>
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

      <RankingModal :seed="store.seed!" :open="showRanking" :mode="selectedMode" @close="showRanking = false" />
      <DebugPanel v-if="isDev" ref="debugPanel" />
    </template>
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
  display: flex;
  align-items: center;
  gap: 4px;
}
.mode-badge {
  background: var(--brand);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  font-family: sans-serif;
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
